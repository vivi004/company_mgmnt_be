const db = require('../config/db');

/**
 * THE UNIFIED SOURCE-OF-TRUTH RIPPLE (HIGH-PERFORMANCE EDITIONS)
 * Recalculates shop balances and daily collections sequentially in memory,
 * then commits all updates to the database in batch using CASE statements.
 */
async function rebuildRipple(connection, shopId, targetDate) {
    console.log(`[RIPPLE] Starting optimized master ripple for Shop #${shopId} from ${targetDate}`);

    // Helper to get YYYY-MM-DD in IST
    const toISTDate = (date) => {
        const d = typeof date === 'string' ? new Date(date) : date;
        return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    };

    // 1. Get the starting balance before this date
    const [prevTx] = await connection.query(
        `SELECT balance_after FROM shop_transactions 
         WHERE shop_id = ? AND transaction_date < ? 
         ORDER BY transaction_date DESC, id DESC LIMIT 1`,
        [shopId, targetDate]
    );

    let runningBalance = 0;
    if (prevTx.length > 0) {
        runningBalance = parseFloat(prevTx[0].balance_after);
    } else {
        const [shopInfo] = await connection.query(
            'SELECT COALESCE(opening_balance, 0) as opening_balance FROM shop_balances WHERE shop_id = ?',
            [shopId]
        );
        runningBalance = shopInfo.length > 0 ? parseFloat(shopInfo[0].opening_balance) : 0;
    }

    const initialBalance = runningBalance;

    // 2. Fetch all transactions from targetDate onwards
    const [transactions] = await connection.query(
        `SELECT id, amount, type, payment_mode, transaction_date 
         FROM shop_transactions 
         WHERE shop_id = ? AND transaction_date >= ? 
         ORDER BY transaction_date ASC, id ASC`,
         [shopId, targetDate]
    );

    const dailyAggregates = {}; 

    // 3. Process transactions in-memory
    for (const tx of transactions) {
        const amount = parseFloat(tx.amount);
        const type = tx.type;
        const mode = (tx.payment_mode || '').toUpperCase();
        const dateStr = toISTDate(tx.transaction_date);

        if (type === 'Bill') {
            runningBalance += amount;
        } else if (type === 'Payment') {
            runningBalance -= amount;
        } else if (type === 'Adjustment') {
            runningBalance += amount; 
        }

        // Store new balance in-memory to update later in batch
        tx.new_balance_after = runningBalance;

        if (!dailyAggregates[dateStr]) {
            dailyAggregates[dateStr] = { bill: 0, cash: 0, upi: 0, cheque: 0, adj: 0 };
        }
        
        if (type === 'Bill') {
            dailyAggregates[dateStr].bill += amount;
        } else if (type === 'Payment') {
            if (mode.includes('UPI') || mode.includes('GPAY') || mode.includes('PHONEPE') || mode.includes('PAYTM')) {
                dailyAggregates[dateStr].upi += amount;
            } else if (mode.includes('CHEQUE') || mode.includes('CHECK')) {
                dailyAggregates[dateStr].cheque += amount;
            } else if (mode === 'DISCOUNT') {
                dailyAggregates[dateStr].adj -= amount; 
            } else {
                dailyAggregates[dateStr].cash += amount;
            }
        } else if (type === 'Adjustment') {
            dailyAggregates[dateStr].adj += amount;
        }
    }

    // HIGH-PERFORMANCE BATCH UPDATE 1: shop_transactions
    if (transactions.length > 0) {
        let txSql = 'UPDATE shop_transactions SET balance_after = CASE id ';
        const txParams = [];
        for (const tx of transactions) {
            txSql += 'WHEN ? THEN ? ';
            txParams.push(tx.id, tx.new_balance_after);
        }
        txSql += 'END WHERE id IN (' + transactions.map(() => '?').join(',') + ')';
        const txIds = transactions.map(tx => tx.id);
        
        await connection.query(txSql, [...txParams, ...txIds]);
        console.log(`[RIPPLE] Batch updated ${transactions.length} shop transactions in 1 query.`);
    }

    // 4. Fetch all future bills for this shop
    const [futureBillRows] = await connection.query(
        `SELECT total_amount, CONVERT_TZ(delivery_date, '+00:00', '+05:30') as del_date 
         FROM bills 
         WHERE shop_id = ? AND is_applied_to_balance = 0`,
        [shopId]
    );
    
    // 5. Fetch all future collection dates
    const [dates] = await connection.query(
        `SELECT DISTINCT collection_date FROM daily_collections 
         WHERE shop_id = ? AND collection_date >= ? 
         ORDER BY collection_date ASC`,
        [shopId, targetDate]
    );

    const [prevDay] = await connection.query(
        `SELECT total_balance FROM daily_collections 
         WHERE shop_id = ? AND collection_date < ? 
         ORDER BY collection_date DESC LIMIT 1`,
        [shopId, targetDate]
    );
    
    let lastDayTotal = prevDay.length > 0 ? parseFloat(prevDay[0].total_balance) : (prevTx.length > 0 ? parseFloat(prevTx[0].balance_after) : initialBalance);

    const dcUpdates = [];

    // Calculate all daily_collections updates in-memory
    for (const d of dates) {
        const dStr = toISTDate(d.collection_date);
        const agg = dailyAggregates[dStr] || { bill: 0, cash: 0, upi: 0, cheque: 0, adj: 0 };
        
        const newOldBal = lastDayTotal;
        const newTotalBal = newOldBal + agg.bill - (agg.cash + agg.upi + agg.cheque) + agg.adj;

        const dayFutureBills = futureBillRows
            .filter(b => b.del_date.toISOString().split('T')[0] > dStr)
            .reduce((sum, b) => sum + parseFloat(b.total_amount), 0);

        dcUpdates.push({
            collection_date: d.collection_date,
            old_balance: newOldBal,
            todays_bill_amount: agg.bill,
            cash_collected: agg.cash,
            upi_collected: agg.upi,
            cheque_collected: agg.cheque,
            manual_adjustments: agg.adj,
            total_balance: newTotalBal,
            future_bills: dayFutureBills
        });

        lastDayTotal = newTotalBal;
    }

    // HIGH-PERFORMANCE BATCH UPDATE 2: daily_collections
    if (dcUpdates.length > 0) {
        let dcSql = 'UPDATE daily_collections SET ';
        const fields = ['old_balance', 'todays_bill_amount', 'cash_collected', 'upi_collected', 'cheque_collected', 'manual_adjustments', 'total_balance', 'future_bills'];
        const sqlParts = [];
        const dcParams = [];

        fields.forEach(field => {
            let part = `${field} = CASE collection_date `;
            dcUpdates.forEach(row => {
                part += 'WHEN ? THEN ? ';
                dcParams.push(row.collection_date, row[field]);
            });
            part += 'END';
            sqlParts.push(part);
        });

        dcSql += sqlParts.join(', ');
        dcSql += ' WHERE shop_id = ? AND collection_date IN (' + dcUpdates.map(() => '?').join(',') + ')';
        
        dcParams.push(shopId);
        dcUpdates.forEach(row => dcParams.push(row.collection_date));

        await connection.query(dcSql, dcParams);
        console.log(`[RIPPLE] Batch updated ${dcUpdates.length} daily collection dates in 1 query.`);
    }

    // 6. Update general shop balance in shop_balances
    await connection.query(
        'INSERT INTO shop_balances (shop_id, balance) VALUES (?, ?) ON DUPLICATE KEY UPDATE balance = VALUES(balance)',
        [shopId, runningBalance]
    );

    return runningBalance;
}

module.exports = { rebuildRipple };
