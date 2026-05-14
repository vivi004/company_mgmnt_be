const db = require('../config/db');

/**
 * THE UNIFIED SOURCE-OF-TRUTH RIPPLE
 */
async function rebuildRipple(connection, shopId, targetDate) {
    console.log(`[RIPPLE] Starting master ripple for Shop #${shopId} from ${targetDate}`);

    // Helper to get YYYY-MM-DD in IST
    const toISTDate = (date) => {
        const d = new Date(date);
        // If it's already a Date object from MySQL, it might be in UTC. 
        // We add 5.5 hours to ensure we're looking at the IST day.
        const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
        return ist.toISOString().split('T')[0];
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

    // 2. Fetch all transactions from targetDate onwards
    const [transactions] = await connection.query(
        `SELECT * FROM shop_transactions 
         WHERE shop_id = ? AND transaction_date >= ? 
         ORDER BY transaction_date ASC, id ASC`,
        [shopId, targetDate]
    );

    const dailyAggregates = {}; 

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

        await connection.query(
            'UPDATE shop_transactions SET balance_after = ? WHERE id = ?',
            [runningBalance, tx.id]
        );

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

    // 3. Fetch all future bills for this shop to correctly populate future_bills column
    const [futureBillRows] = await connection.query(
        `SELECT total_amount, CONVERT_TZ(delivery_date, '+00:00', '+05:30') as del_date 
         FROM bills 
         WHERE shop_id = ? AND is_applied_to_balance = 0`,
        [shopId]
    );
    
    // We'll calculate future_bills dynamically for each day in the loop below

    // 4. Update daily_collections sequentially
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
    
    let lastDayTotal = prevDay.length > 0 ? parseFloat(prevDay[0].total_balance) : (prevTx.length > 0 ? parseFloat(prevTx[0].balance_after) : runningBalance);

    for (const d of dates) {
        const dStr = toISTDate(d.collection_date);
        const agg = dailyAggregates[dStr] || { bill: 0, cash: 0, upi: 0, cheque: 0, adj: 0 };
        
        const newOldBal = lastDayTotal;
        const newTotalBal = newOldBal + agg.bill - (agg.cash + agg.upi + agg.cheque) + agg.adj;

        // Calculate future_bills for this specific day
        // It's the sum of all bills where delivery_date > this day AND NOT YET APPLIED
        const dayFutureBills = futureBillRows
            .filter(b => b.del_date.toISOString().split('T')[0] > dStr)
            .reduce((sum, b) => sum + parseFloat(b.total_amount), 0);

        await connection.query(
            `UPDATE daily_collections 
             SET old_balance = ?, 
                 todays_bill_amount = ?,
                 cash_collected = ?,
                 upi_collected = ?,
                 cheque_collected = ?,
                 manual_adjustments = ?,
                 total_balance = ?,
                 future_bills = ?
             WHERE shop_id = ? AND collection_date = ?`,
            [newOldBal, agg.bill, agg.cash, agg.upi, agg.cheque, agg.adj, newTotalBal, dayFutureBills, shopId, d.collection_date]
        );

        lastDayTotal = newTotalBal;
    }

    await connection.query(
        'INSERT INTO shop_balances (shop_id, balance) VALUES (?, ?) ON DUPLICATE KEY UPDATE balance = VALUES(balance)',
        [shopId, runningBalance]
    );

    return runningBalance;
}

module.exports = { rebuildRipple };
