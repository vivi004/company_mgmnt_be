const db = require('../config/db');

/**
 * THE UNIFIED SOURCE-OF-TRUTH RIPPLE
 */
async function rebuildRipple(connection, shopId, targetDate) {
    console.log(`[RIPPLE] Starting master ripple for Shop #${shopId} from ${targetDate}`);

    // Helper to get YYYY-MM-DD in IST
    const toISTDate = (date) => {
        const d = typeof date === 'string' ? new Date(date) : date;
        // Format to YYYY-MM-DD in Asia/Kolkata timezone
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
        `SELECT * FROM shop_transactions 
         WHERE shop_id = ? AND transaction_date >= ? 
         ORDER BY transaction_date ASC, id ASC`,
        [shopId, targetDate]
    );

    const dailyAggregates = {};

    // ── BATCH UPDATE: build id→balance_after map in JS, flush in one query ──
    const balanceUpdates = []; // [{id, balance_after}]

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

        balanceUpdates.push({ id: tx.id, balance_after: runningBalance });

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

    // Single batch UPDATE for all transaction balance_after values
    // ── Chunked to 500 rows to stay under MySQL max_allowed_packet (16MB) ──
    const CHUNK_SIZE = 500;
    for (let i = 0; i < balanceUpdates.length; i += CHUNK_SIZE) {
        const chunk = balanceUpdates.slice(i, i + CHUNK_SIZE);
        const caseWhen = chunk.map(() => `WHEN id = ? THEN ?`).join(' ');
        const ids = chunk.map(u => u.id);
        const flatParams = chunk.flatMap(u => [u.id, u.balance_after]);

        await connection.query(
            `UPDATE shop_transactions 
             SET balance_after = CASE ${caseWhen} ELSE balance_after END
             WHERE shop_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
            [...flatParams, shopId, ...ids]
        );
    }


    // 3. Fetch all future bills for this shop to correctly populate future_bills column
    const [futureBillRows] = await connection.query(
        `SELECT total_amount, CONVERT_TZ(delivery_date, '+00:00', '+05:30') as del_date 
         FROM bills 
         WHERE shop_id = ? AND is_applied_to_balance = 0`,
        [shopId]
    );

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

    let lastDayTotal = prevDay.length > 0 ? parseFloat(prevDay[0].total_balance) : (prevTx.length > 0 ? parseFloat(prevTx[0].balance_after) : initialBalance);

    // ── BATCH UPDATE: build all daily_collections rows in JS, flush in one query ──
    const collectionRows = [];

    for (const d of dates) {
        const dStr = toISTDate(d.collection_date);
        const agg = dailyAggregates[dStr] || { bill: 0, cash: 0, upi: 0, cheque: 0, adj: 0 };

        const newOldBal = lastDayTotal;
        const newTotalBal = newOldBal + agg.bill - (agg.cash + agg.upi + agg.cheque) + agg.adj;

        const dayFutureBills = futureBillRows
            .filter(b => b.del_date.toISOString().split('T')[0] > dStr)
            .reduce((sum, b) => sum + parseFloat(b.total_amount), 0);

        collectionRows.push({
            collection_date: d.collection_date,
            old_balance: newOldBal,
            bill: agg.bill,
            cash: agg.cash,
            upi: agg.upi,
            cheque: agg.cheque,
            adj: agg.adj,
            total_balance: newTotalBal,
            future_bills: dayFutureBills
        });

        lastDayTotal = newTotalBal;
    }

    // Single batch UPDATE for all daily_collections rows
    if (collectionRows.length > 0) {
        const values = collectionRows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        const flatParams = collectionRows.flatMap(r => [
            shopId, r.collection_date,
            r.old_balance, r.bill, r.cash, r.upi, r.cheque, r.adj, r.total_balance
        ]);

        await connection.query(
            `INSERT INTO daily_collections
                (shop_id, collection_date, old_balance, todays_bill_amount, cash_collected, upi_collected, cheque_collected, manual_adjustments, total_balance)
             VALUES ${values}
             ON DUPLICATE KEY UPDATE
                old_balance        = VALUES(old_balance),
                todays_bill_amount = VALUES(todays_bill_amount),
                cash_collected     = VALUES(cash_collected),
                upi_collected      = VALUES(upi_collected),
                cheque_collected   = VALUES(cheque_collected),
                manual_adjustments = VALUES(manual_adjustments),
                total_balance      = VALUES(total_balance)`,
            flatParams
        );

        // Update future_bills separately (computed per-row, not batch-friendly)
        for (const r of collectionRows) {
            await connection.query(
                'UPDATE daily_collections SET future_bills = ? WHERE shop_id = ? AND collection_date = ?',
                [r.future_bills, shopId, r.collection_date]
            );
        }
    }

    await connection.query(
        'INSERT INTO shop_balances (shop_id, balance) VALUES (?, ?) ON DUPLICATE KEY UPDATE balance = VALUES(balance)',
        [shopId, runningBalance]
    );

    return runningBalance;
}

module.exports = { rebuildRipple };
