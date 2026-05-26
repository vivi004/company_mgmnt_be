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

    // Find all shop IDs in the linked group
    const [shopRows] = await connection.query('SELECT parent_shop_id FROM shops WHERE id = ?', [shopId]);
    let linkedShopIds = [shopId];
    if (shopRows.length > 0) {
        const parentId = shopRows[0].parent_shop_id || shopId;
        const [groupRows] = await connection.query('SELECT id FROM shops WHERE id = ? OR parent_shop_id = ?', [parentId, parentId]);
        if (groupRows.length > 0) {
            linkedShopIds = groupRows.map(r => r.id);
        }
    }
    console.log(`[RIPPLE] Linked Shop IDs in group: ${linkedShopIds.join(', ')}`);

    // Fetch details for all group shops so we have their names, routes, and villages for daily_collections
    const [groupDetailRows] = await connection.query('SELECT id, shop_name, village_name, order_line_id FROM shops WHERE id IN (?)', [linkedShopIds]);
    const shopDetailsMap = {};
    for (const row of groupDetailRows) {
        shopDetailsMap[row.id] = row;
    }

    // 1. Get the group's earliest registration date and max of opening balances
    const [shopInfo] = await connection.query(
        'SELECT COALESCE(MAX(sb.opening_balance), 0) as opening_balance, MIN(DATE(s.created_at)) as created_date FROM shops s LEFT JOIN shop_balances sb ON s.id = sb.shop_id WHERE s.id IN (?)',
        [linkedShopIds]
    );
    const createdDateStr = shopInfo.length > 0 ? toISTDate(shopInfo[0].created_date) : '2000-01-01';
    const openingBalance = shopInfo.length > 0 ? parseFloat(shopInfo[0].opening_balance) : 0;

    // Get the starting balance before this date from approved transactions in the group
    const [prevTx] = await connection.query(
        `SELECT balance_after FROM shop_transactions 
         WHERE shop_id IN (?) AND transaction_date < ? AND approval_status = 'APPROVED'
         ORDER BY transaction_date DESC, id DESC LIMIT 1`,
        [linkedShopIds, targetDate]
    );

    let runningBalance = 0;
    if (prevTx.length > 0) {
        runningBalance = parseFloat(prevTx[0].balance_after);
    } else {
        if (toISTDate(targetDate) >= createdDateStr) {
            runningBalance = openingBalance;
        } else {
            runningBalance = 0;
        }
    }

    const initialBalance = runningBalance;

    // 2. Fetch all transactions from targetDate onwards for the group
    const [transactions] = await connection.query(
        `SELECT id, shop_id, amount, type, payment_mode, transaction_date, approval_status 
         FROM shop_transactions 
         WHERE shop_id IN (?) AND transaction_date >= ? 
         ORDER BY transaction_date ASC, id ASC`,
         [linkedShopIds, targetDate]
    );

    // Initialize daily aggregates structure for each shop in the group
    const dailyAggregates = {}; 
    for (const shopIdItem of linkedShopIds) {
        dailyAggregates[shopIdItem] = {};
    }

    let openingBalanceApplied = false;
    if (prevTx.length > 0 || toISTDate(targetDate) >= createdDateStr) {
        openingBalanceApplied = true;
    }

    // 3. Process transactions in-memory
    for (const tx of transactions) {
        const amount = parseFloat(tx.amount);
        const type = tx.type;
        const mode = (tx.payment_mode || '').toUpperCase();
        const dateStr = toISTDate(tx.transaction_date);
        const txShopId = tx.shop_id;

        if (!openingBalanceApplied && dateStr >= createdDateStr) {
            runningBalance += openingBalance;
            openingBalanceApplied = true;
        }

        if (tx.approval_status === 'APPROVED') {
            if (type === 'Bill') {
                runningBalance += amount;
            } else if (type === 'Payment') {
                runningBalance -= amount;
            } else if (type === 'Adjustment') {
                runningBalance += amount; 
            } else if (type === 'Return') {
                runningBalance -= amount;
            }

            if (!dailyAggregates[txShopId][dateStr]) {
                dailyAggregates[txShopId][dateStr] = { bill: 0, cash: 0, upi: 0, cheque: 0, adj: 0, returns: 0 };
            }
            
            if (type === 'Bill') {
                dailyAggregates[txShopId][dateStr].bill += amount;
            } else if (type === 'Payment') {
                if (mode.includes('UPI') || mode.includes('GPAY') || mode.includes('PHONEPE') || mode.includes('PAYTM')) {
                    dailyAggregates[txShopId][dateStr].upi += amount;
                } else if (mode.includes('CHEQUE') || mode.includes('CHECK')) {
                    dailyAggregates[txShopId][dateStr].cheque += amount;
                } else if (mode === 'DISCOUNT') {
                    dailyAggregates[txShopId][dateStr].adj -= amount; 
                } else {
                    dailyAggregates[txShopId][dateStr].cash += amount;
                }
            } else if (type === 'Adjustment') {
                dailyAggregates[txShopId][dateStr].adj += amount;
            } else if (type === 'Return') {
                dailyAggregates[txShopId][dateStr].returns += amount;
            }
        }

        // Store new balance in-memory to update later in batch
        tx.new_balance_after = runningBalance;
    }

    if (!openingBalanceApplied) {
        runningBalance += openingBalance;
        openingBalanceApplied = true;
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

    // 4. Fetch all future bills for this group of shops
    const [futureBillRows] = await connection.query(
        `SELECT shop_id, total_amount, CONVERT_TZ(delivery_date, '+00:00', '+05:30') as del_date 
         FROM bills 
         WHERE shop_id IN (?) AND is_applied_to_balance = 0`,
        [linkedShopIds]
    );
    
    // 5. Fetch all future collection dates for the group
    const [dates] = await connection.query(
        `SELECT DISTINCT collection_date FROM daily_collections 
         WHERE shop_id IN (?) AND collection_date >= ? 
         ORDER BY collection_date ASC`,
        [linkedShopIds, targetDate]
    );

    const [prevDay] = await connection.query(
        `SELECT total_balance FROM daily_collections 
         WHERE shop_id IN (?) AND collection_date < ? 
         ORDER BY collection_date DESC LIMIT 1`,
        [linkedShopIds, targetDate]
    );
    
    let lastDayTotal = prevDay.length > 0 
        ? parseFloat(prevDay[0].total_balance) 
        : (prevTx.length > 0 
            ? parseFloat(prevTx[0].balance_after) 
            : (toISTDate(targetDate) >= createdDateStr ? openingBalance : 0));

    const dcUpdates = [];
    let dcOpeningBalanceApplied = false;
    if (prevDay.length > 0 || prevTx.length > 0 || toISTDate(targetDate) >= createdDateStr) {
        dcOpeningBalanceApplied = true;
    }

    // Calculate all daily_collections updates in-memory
    for (const d of dates) {
        const dStr = toISTDate(d.collection_date);
        
        if (!dcOpeningBalanceApplied && dStr >= createdDateStr) {
            lastDayTotal += openingBalance;
            dcOpeningBalanceApplied = true;
        }

        // 1. Calculate combined aggregates across all shops in the group for this date
        let dayGroupBill = 0;
        let dayGroupCash = 0;
        let dayGroupUpi = 0;
        let dayGroupCheque = 0;
        let dayGroupAdj = 0;
        let dayGroupReturns = 0;

        for (const shopIdItem of linkedShopIds) {
            const agg = dailyAggregates[shopIdItem][dStr] || { bill: 0, cash: 0, upi: 0, cheque: 0, adj: 0, returns: 0 };
            dayGroupBill += agg.bill;
            dayGroupCash += agg.cash;
            dayGroupUpi += agg.upi;
            dayGroupCheque += agg.cheque;
            dayGroupAdj += agg.adj;
            dayGroupReturns += agg.returns;
        }

        const newOldBal = lastDayTotal;
        const newTotalBal = newOldBal + dayGroupBill - (dayGroupCash + dayGroupUpi + dayGroupCheque) + dayGroupAdj - dayGroupReturns;

        // 2. Add updates for each shop in the group specifically
        for (const shopIdItem of linkedShopIds) {
            const agg = dailyAggregates[shopIdItem][dStr] || { bill: 0, cash: 0, upi: 0, cheque: 0, adj: 0, returns: 0 };
            const dayFutureBills = futureBillRows
                .filter(b => b.shop_id === shopIdItem && b.del_date && toISTDate(b.del_date) > dStr)
                .reduce((sum, b) => sum + parseFloat(b.total_amount), 0);

            const shopMeta = shopDetailsMap[shopIdItem] || { shop_name: '', village_name: '', order_line_id: 0 };

            dcUpdates.push({
                shop_id: shopIdItem,
                shop_name: shopMeta.shop_name,
                village_name: shopMeta.village_name || '',
                order_line_id: shopMeta.order_line_id,
                collection_date: d.collection_date,
                old_balance: newOldBal,
                todays_bill_amount: agg.bill,
                cash_collected: agg.cash,
                upi_collected: agg.upi,
                cheque_collected: agg.cheque,
                manual_adjustments: agg.adj,
                return_amount: agg.returns || 0,
                total_balance: newTotalBal,
                future_bills: dayFutureBills
            });
        }

        lastDayTotal = newTotalBal;
    }

    // HIGH-PERFORMANCE BATCH UPSERT: daily_collections using ON DUPLICATE KEY UPDATE
    if (dcUpdates.length > 0) {
        const insertFields = [
            'shop_id', 'shop_name', 'village_name', 'order_line_id', 'collection_date', 'old_balance', 'todays_bill_amount', 
            'cash_collected', 'upi_collected', 'cheque_collected', 
            'manual_adjustments', 'return_amount', 'total_balance', 'future_bills'
        ];
        
        let dcSql = `INSERT INTO daily_collections (${insertFields.join(', ')}) VALUES `;
        const dcParams = [];
        
        const valuePlaceholders = dcUpdates.map(row => {
            dcParams.push(
                row.shop_id, row.shop_name, row.village_name, row.order_line_id, row.collection_date, row.old_balance, row.todays_bill_amount,
                row.cash_collected, row.upi_collected, row.cheque_collected,
                row.manual_adjustments, row.return_amount, row.total_balance, row.future_bills
            );
            return '(' + insertFields.map(() => '?').join(', ') + ')';
        }).join(', ');
        
        dcSql += valuePlaceholders;
        dcSql += ` ON DUPLICATE KEY UPDATE 
            old_balance = VALUES(old_balance),
            todays_bill_amount = VALUES(todays_bill_amount),
            cash_collected = VALUES(cash_collected),
            upi_collected = VALUES(upi_collected),
            cheque_collected = VALUES(cheque_collected),
            manual_adjustments = VALUES(manual_adjustments),
            return_amount = VALUES(return_amount),
            total_balance = VALUES(total_balance),
            future_bills = VALUES(future_bills)`;

        await connection.query(dcSql, dcParams);
        console.log(`[RIPPLE] Batch updated ${dcUpdates.length} daily collection rows.`);
    }

    // 6. Update general shop balance in shop_balances for all shops in the group
    for (const shopIdItem of linkedShopIds) {
        await connection.query(
            'INSERT INTO shop_balances (shop_id, balance) VALUES (?, ?) ON DUPLICATE KEY UPDATE balance = VALUES(balance)',
            [shopIdItem, runningBalance]
        );
    }

    return runningBalance;
}

module.exports = { rebuildRipple };
