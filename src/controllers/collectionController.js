const db = require('../config/db');
const cacheService = require('../services/cacheService');
const webhookService = require('../services/webhookService');
const financialService = require('../services/financialService');

/**
 * GET /api/collections?date=YYYY-MM-DD
 * Returns all daily_collections grouped by order_line for the given date.
 * Admin-only: sees all order lines.
 */
exports.getCollectionsByDate = async (req, res) => {
    const { date } = req.query;
    if (!date) {
        return res.status(400).json({ error: 'date query parameter is required (YYYY-MM-DD)' });
    }

    const cacheKey = `collections:all:${date}`;
    const cachedData = cacheService.get(cacheKey);
    if (cachedData) {
        // console.log(`[CACHE HIT] Serving all collections for date: ${date}`);
        return res.json(cachedData);
    }

    try {
        const [rows] = await db.query(`
            SELECT dc.id, dc.shop_id, dc.shop_name, dc.village_name, dc.order_line_id, dc.collection_date,
                   dc.todays_bill_amount, dc.cash_collected, dc.upi_collected, dc.cheque_collected,
                   dc.old_balance, dc.total_balance, dc.future_bills, dc.manual_adjustments, dc.return_amount, dc.last_updated,
                   ol.name AS order_line_name, ol.node_id
            FROM daily_collections dc
            JOIN order_lines ol ON dc.order_line_id = ol.id
            WHERE dc.collection_date = ?
            ORDER BY ol.name ASC, dc.shop_name ASC
        `, [date]);
        
        // Cache result for 10 seconds (short-term buffer for heavy bursts)
        cacheService.set(cacheKey, rows, 10);
        res.json(rows);
    } catch (err) {
        console.error('getCollectionsByDate error:', err);
        res.status(500).json({ error: 'Failed to fetch collections' });
    }
};

/**
 * GET /api/collections/by-orderline/:olId?date=YYYY-MM-DD
 * Returns daily_collections for a specific order line + date.
 * Both Admin and Staff can access (staff access verified below).
 */
exports.getCollectionsByOrderLine = async (req, res) => {
    const { olId } = req.params;
    const { date } = req.query;
    if (!date) {
        return res.status(400).json({ error: 'date query parameter is required (YYYY-MM-DD)' });
    }

    // Staff access check: verify the user has access to this order line
    if (req.user && req.user.role === 'staff') {
        try {
            const [empRows] = await db.query(
                'SELECT accessible_orderlines FROM employees WHERE id = ?',
                [req.user.id]
            );
            if (empRows.length > 0) {
                let accessible = empRows[0].accessible_orderlines;
                if (typeof accessible === 'string') {
                    try { accessible = JSON.parse(accessible); } catch { accessible = []; }
                }
                if (Array.isArray(accessible) && !accessible.includes(parseInt(olId))) {
                    return res.status(403).json({ error: 'Access denied to this order line' });
                }
            }
        } catch (e) {
            console.error('Staff access check error:', e);
        }
    }

    const cacheKey = `collections:${olId}:${date}`;
    const cachedData = cacheService.get(cacheKey);
    if (cachedData) {
        // console.log(`[CACHE HIT] Serving collections for Order Line #${olId} on ${date}`);
        return res.json(cachedData);
    }

    try {
        // This robust query fetches ALL shops for the order line.
        const [rows] = await db.query(`
            SELECT 
                s.id AS shop_id,
                s.shop_name,
                s.village_name,
                s.owner_name AS owner_name,
                s.order_line_id,
                ? AS collection_date,
                ol.name AS order_line_name,
                ol.node_id,
                COALESCE(dc.todays_bill_amount, 0) AS todays_bill_amount,
                COALESCE(dc.cash_collected, 0) AS cash_collected,
                COALESCE(dc.upi_collected, 0) AS upi_collected,
                COALESCE(dc.cheque_collected, 0) AS cheque_collected,
                COALESCE(dc.future_bills, 0) AS future_bills,
                COALESCE(dc.manual_adjustments, 0) AS manual_adjustments,
                COALESCE(dc.return_amount, 0) AS return_amount,
                
                -- APPROVED Manual Adjustment Breakdown
                COALESCE(adj.discount_payment, 0) AS discount_payment,
                COALESCE(adj.discount_adjustment, 0) AS discount_adjustment,
                COALESCE(adj.m_cash, 0) AS manual_cash,
                COALESCE(adj.m_upi, 0) AS manual_upi,
                COALESCE(adj.m_cheque, 0) AS manual_cheque,
                COALESCE(adj.m_pos, 0) AS manual_pos,

                -- PENDING Transactions for the row
                COALESCE(pt.pending_json, '[]') AS pending_transactions,

                -- The PREV BAL logic
                COALESCE(dc.old_balance, COALESCE(prev.total_balance, COALESCE(sb.balance, 0))) AS old_balance,

                -- The TOTAL BAL logic
                COALESCE(
                    dc.total_balance,
                    COALESCE(prev.total_balance, COALESCE(sb.balance, 0)) + COALESCE(dc.todays_bill_amount, 0) - (COALESCE(dc.cash_collected, 0) + COALESCE(dc.upi_collected, 0) + COALESCE(dc.cheque_collected, 0)) + COALESCE(dc.manual_adjustments, 0) - COALESCE(dc.return_amount, 0)
                ) AS total_balance
            FROM shops s
            JOIN order_lines ol ON s.order_line_id = ol.id
            LEFT JOIN shop_balances sb ON s.id = sb.shop_id
            LEFT JOIN daily_collections dc ON s.id = dc.shop_id AND dc.collection_date = ?
            LEFT JOIN (
                SELECT dc1.shop_id, dc1.total_balance
                FROM daily_collections dc1
                INNER JOIN (
                    SELECT shop_id, MAX(collection_date) as max_date
                    FROM daily_collections
                    WHERE collection_date < ?
                    GROUP BY shop_id
                ) dc2 ON dc1.shop_id = dc2.shop_id AND dc1.collection_date = dc2.max_date
            ) prev ON s.id = prev.shop_id
            LEFT JOIN (
                SELECT 
                    shop_id,
                    SUM(CASE WHEN type = 'Payment' AND payment_mode = 'DISCOUNT' THEN amount ELSE 0 END) as discount_payment,
                    SUM(CASE WHEN type = 'Adjustment' AND payment_mode = 'DISCOUNT' THEN ABS(amount) ELSE 0 END) as discount_adjustment,
                    SUM(CASE WHEN amount < 0 AND type = 'Adjustment' AND payment_mode = 'CASH' THEN ABS(amount) ELSE 0 END) as m_cash,
                    SUM(CASE WHEN amount < 0 AND type = 'Adjustment' AND payment_mode = 'UPI' THEN ABS(amount) ELSE 0 END) as m_upi,
                    SUM(CASE WHEN amount < 0 AND type = 'Adjustment' AND payment_mode = 'CHEQUE' THEN ABS(amount) ELSE 0 END) as m_cheque,
                    SUM(CASE WHEN amount > 0 AND type = 'Adjustment' THEN amount ELSE 0 END) as m_pos
                FROM shop_transactions
                WHERE approval_status = 'APPROVED' AND transaction_date >= ? AND transaction_date < DATE_ADD(?, INTERVAL 1 DAY)
                GROUP BY shop_id
            ) adj ON s.id = adj.shop_id
            LEFT JOIN (
                SELECT 
                    shop_id,
                    JSON_ARRAYAGG(
                        JSON_OBJECT(
                            'id', id,
                            'type', type,
                            'category', transaction_category,
                            'amount', amount,
                            'mode', payment_mode,
                            'description', description
                        )
                    ) as pending_json
                FROM shop_transactions
                WHERE approval_status = 'PENDING' AND transaction_date >= ? AND transaction_date < DATE_ADD(?, INTERVAL 1 DAY)
                GROUP BY shop_id
            ) pt ON s.id = pt.shop_id
            WHERE s.order_line_id = ?
            ORDER BY s.shop_name ASC
        `, [date, date, date, date, date, date, date, olId]);

        // FETCH EXPENSES
        const [expRows] = await db.query(`
            SELECT id, order_line_id, amount, description, expense_date, created_at FROM daily_expenses
            WHERE order_line_id = ? AND expense_date = ?
        `, [olId, date]);

        const responsePayload = {
            collections: rows,
            expenses: expRows
        };

        // Cache the formatted collections and expenses payload for 10 seconds
        cacheService.set(cacheKey, responsePayload, 10);
        res.json(responsePayload);
    } catch (err) {
        console.error('getCollectionsByOrderLine error:', err);
        res.status(500).json({ error: 'Failed to fetch collections for order line' });
    }
};

/**
 * POST /api/collections/expenses
 * Adds a new daily expense.
 */
exports.addExpense = async (req, res) => {
    const { order_line_id, amount, description, date } = req.body;

    if (!order_line_id || !amount || !date) {
        return res.status(400).json({ error: 'order_line_id, amount, and date are required' });
    }

    try {
        await db.query(`
            INSERT INTO daily_expenses (order_line_id, amount, description, expense_date)
            VALUES (?, ?, ?, ?)
        `, [order_line_id, amount, description || '', date]);

        // Clear dashboard caching on write
        cacheService.flush();

        res.json({ message: 'Expense added successfully' });
    } catch (err) {
        console.error('addExpense error:', err);
        res.status(500).json({ error: 'Failed to add expense' });
    }
};

/**
 * PUT /api/collections/expenses/:id
 * Updates an existing expense.
 */
exports.updateExpense = async (req, res) => {
    const { id } = req.params;
    const { amount, description } = req.body;

    if (!amount) {
        return res.status(400).json({ error: 'amount is required' });
    }

    try {
        await db.query(`
            UPDATE daily_expenses 
            SET amount = ?, description = ?
            WHERE id = ?
        `, [amount, description || '', id]);

        // Clear dashboard caching on write
        cacheService.flush();

        res.json({ message: 'Expense updated successfully' });
    } catch (err) {
        console.error('updateExpense error:', err);
        res.status(500).json({ error: 'Failed to update expense' });
    }
};

/**
 * DELETE /api/collections/expenses/:id
 * Deletes an expense.
 */
exports.deleteExpense = async (req, res) => {
    const { id } = req.params;

    try {
        await db.query('DELETE FROM daily_expenses WHERE id = ?', [id]);

        // Clear dashboard caching on write
        cacheService.flush();

        res.json({ message: 'Expense deleted successfully' });
    } catch (err) {
        console.error('deleteExpense error:', err);
        res.status(500).json({ error: 'Failed to delete expense' });
    }
};

/**
 * GET /api/collections/returns?date=YYYY-MM-DD
 * OR /api/collections/returns?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * Retrieves all returned products for a specific date or date range across all shops.
 */
exports.getDailyReturns = async (req, res) => {
    const { date, startDate, endDate } = req.query;
    if (!date && (!startDate || !endDate)) {
        return res.status(400).json({ error: 'Either "date" or both "startDate" and "endDate" parameters are required' });
    }

    try {
        let query = `
            SELECT pr.id, pr.shop_id, pr.product_name, pr.amount, pr.created_by, pr.return_date,
                   s.shop_name, s.village_name
            FROM product_returns pr
            JOIN shops s ON pr.shop_id = s.id
            WHERE 1=1
        `;
        const params = [];

        if (date) {
            query += ' AND pr.return_date = ?';
            params.push(date);
        } else {
            if (startDate) {
                query += ' AND pr.return_date >= ?';
                params.push(startDate);
            }
            if (endDate) {
                query += ' AND pr.return_date <= ?';
                params.push(endDate);
            }
        }

        query += ' ORDER BY pr.return_date ASC, s.shop_name ASC, pr.created_at ASC';

        const [rows] = await db.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error('getDailyReturns error:', err);
        res.status(500).json({ error: 'Failed to fetch returns' });
    }
};

/**
 * GET /api/collections/shop-day-details?shopId=X&date=YYYY-MM-DD
 * Admin-only: fetches approved ledger transactions and product returns for a specific shop on a specific date.
 */
exports.getShopDayDetails = async (req, res) => {
    if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'Admin')) {
        return res.status(403).json({ error: 'Access denied: Admin only' });
    }
    const { shopId, date } = req.query;
    if (!shopId || !date) {
        return res.status(400).json({ error: 'shopId and date parameters are required' });
    }
    try {
        // Fetch approved transactions on this date for this shop
        // Date matches the YYYY-MM-DD range of transaction_date in IST
        const [transactions] = await db.query(`
            SELECT id, type, amount, payment_mode, transaction_category, description, transaction_date, created_by
            FROM shop_transactions
            WHERE shop_id = ? AND approval_status = 'APPROVED'
              AND transaction_date >= ? AND transaction_date < DATE_ADD(?, INTERVAL 1 DAY)
            ORDER BY transaction_date ASC, id ASC
        `, [shopId, date, date]);

        // Fetch detailed product returns
        const [returns] = await db.query(`
            SELECT id, product_name, amount, created_by, return_date
            FROM product_returns
            WHERE shop_id = ? AND return_date = ?
            ORDER BY created_at ASC
        `, [shopId, date]);

        res.json({ transactions, returns });
    } catch (err) {
        console.error('getShopDayDetails error:', err);
        res.status(500).json({ error: 'Failed to fetch details for shop and date' });
    }
};

/**
 * PUT /api/collections/transactions/:id/payment
 * Admin-only: edits a payment transaction's details.
 */
exports.editPaymentTransaction = async (req, res) => {
    if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'Admin')) {
        return res.status(403).json({ error: 'Access denied: Admin only' });
    }
    const { id } = req.params;
    const { amount, payment_mode, description } = req.body;

    if (amount === undefined || isNaN(parseFloat(amount)) || parseFloat(amount) < 0) {
        return res.status(400).json({ error: 'A valid numeric amount is required' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Retrieve existing transaction
        const [txs] = await connection.query(
            'SELECT shop_id, type, amount, transaction_date, description FROM shop_transactions WHERE id = ? FOR UPDATE',
            [id]
        );
        if (txs.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Transaction not found' });
        }
        const tx = txs[0];
        if (tx.type !== 'Payment') {
            await connection.rollback();
            return res.status(400).json({ error: 'Transaction is not a payment type' });
        }

        const newAmount = parseFloat(amount);
        const newMode = (payment_mode || 'CASH').toUpperCase();
        const newDesc = description || `Payment Received (${newMode})`;

        // Update transaction row
        await connection.query(
            'UPDATE shop_transactions SET amount = ?, payment_mode = ?, description = ? WHERE id = ?',
            [newAmount, newMode, newDesc, id]
        );

        // Fetch transaction date formatted as YYYY-MM-DD
        const [dateRows] = await connection.query("SELECT DATE_FORMAT(?, '%Y-%m-%d') as tx_date", [tx.transaction_date]);
        const txDate = dateRows[0].tx_date;

        // Perform balance re-ripple to update daily_collections and shop_balances
        await financialService.rebuildRipple(connection, tx.shop_id, txDate);

        await connection.commit();
        cacheService.flush();

        res.json({ message: 'Payment transaction updated successfully' });
    } catch (err) {
        await connection.rollback();
        console.error('editPaymentTransaction error:', err);
        res.status(500).json({ error: err.message || 'Failed to update payment transaction' });
    } finally {
        connection.release();
    }
};

/**
 * PUT /api/collections/transactions/:id/adjustment
 * Admin-only: edits a manual adjustment transaction.
 */
exports.editAdjustmentTransaction = async (req, res) => {
    if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'Admin')) {
        return res.status(403).json({ error: 'Access denied: Admin only' });
    }
    const { id } = req.params;
    const { amount, payment_mode, description } = req.body;

    if (amount === undefined || isNaN(parseFloat(amount))) {
        return res.status(400).json({ error: 'A valid numeric amount is required' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Retrieve existing transaction
        const [txs] = await connection.query(
            'SELECT shop_id, type, transaction_date FROM shop_transactions WHERE id = ? FOR UPDATE',
            [id]
        );
        if (txs.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Transaction not found' });
        }
        const tx = txs[0];
        if (tx.type !== 'Adjustment') {
            await connection.rollback();
            return res.status(400).json({ error: 'Transaction is not an adjustment' });
        }

        const newAmount = parseFloat(amount);
        const newMode = (payment_mode || 'CASH').toUpperCase();
        const newDesc = description || 'Manual Adjustment';

        // Update transaction row
        await connection.query(
            'UPDATE shop_transactions SET amount = ?, payment_mode = ?, payment_method = ?, description = ? WHERE id = ?',
            [newAmount, newMode, newMode, newDesc, id]
        );

        // Fetch transaction date formatted as YYYY-MM-DD
        const [dateRows] = await connection.query("SELECT DATE_FORMAT(?, '%Y-%m-%d') as tx_date", [tx.transaction_date]);
        const txDate = dateRows[0].tx_date;

        // Perform balance re-ripple to update daily_collections and shop_balances
        await financialService.rebuildRipple(connection, tx.shop_id, txDate);

        await connection.commit();
        cacheService.flush();

        res.json({ message: 'Adjustment transaction updated successfully' });
    } catch (err) {
        await connection.rollback();
        console.error('editAdjustmentTransaction error:', err);
        res.status(500).json({ error: err.message || 'Failed to update adjustment transaction' });
    } finally {
        connection.release();
    }
};

/**
 * DELETE /api/collections/transactions/:id
 * Admin-only: deletes a transaction.
 */
exports.deleteTransaction = async (req, res) => {
    if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'Admin')) {
        return res.status(403).json({ error: 'Access denied: Admin only' });
    }
    const { id } = req.params;

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Retrieve existing transaction
        const [txs] = await connection.query(
            'SELECT shop_id, type, amount, transaction_date, description FROM shop_transactions WHERE id = ? FOR UPDATE',
            [id]
        );
        if (txs.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Transaction not found' });
        }
        const tx = txs[0];

        // Format date to YYYY-MM-DD
        const [dateRows] = await connection.query("SELECT DATE_FORMAT(?, '%Y-%m-%d') as tx_date", [tx.transaction_date]);
        const txDate = dateRows[0].tx_date;

        // If transaction is a Return, attempt to clean up product_returns entry
        if (tx.type === 'Return') {
            // Find a product return matching this shop, return date, and amount
            await connection.query(
                `DELETE FROM product_returns 
                 WHERE shop_id = ? AND return_date = ? AND amount = ? 
                 LIMIT 1`,
                [tx.shop_id, txDate, tx.amount]
            );
        }

        // Delete from shop_transactions
        await connection.query('DELETE FROM shop_transactions WHERE id = ?', [id]);

        // Perform balance re-ripple to update daily_collections and shop_balances
        await financialService.rebuildRipple(connection, tx.shop_id, txDate);

        await connection.commit();
        cacheService.flush();

        res.json({ message: 'Transaction deleted successfully' });
    } catch (err) {
        await connection.rollback();
        console.error('deleteTransaction error:', err);
        res.status(500).json({ error: err.message || 'Failed to delete transaction' });
    } finally {
        connection.release();
    }
};

/**
 * PUT /api/collections/returns/:id
 * Admin-only: updates an individual product return entry.
 */
exports.editProductReturn = async (req, res) => {
    if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'Admin')) {
        return res.status(403).json({ error: 'Access denied: Admin only' });
    }
    const { id } = req.params;
    const { product_name, amount } = req.body;

    if (!product_name) {
        return res.status(400).json({ error: 'Product name is required' });
    }
    if (amount === undefined || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        return res.status(400).json({ error: 'A valid positive numeric amount is required' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Retrieve existing return row
        const [returns] = await connection.query(
            'SELECT shop_id, product_name, amount, return_date FROM product_returns WHERE id = ? FOR UPDATE',
            [id]
        );
        if (returns.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Product return entry not found' });
        }
        const ret = returns[0];
        const oldAmount = parseFloat(ret.amount);
        const newAmount = parseFloat(amount);

        // Update product_returns
        await connection.query(
            'UPDATE product_returns SET product_name = ?, amount = ? WHERE id = ?',
            [product_name, newAmount, id]
        );

        // Locate corresponding transaction in shop_transactions
        // Matches type='Return', shop_id, and date, using a flexible query matching amount or description
        const [txs] = await connection.query(`
            SELECT id FROM shop_transactions
            WHERE shop_id = ? AND type = 'Return'
              AND DATE(transaction_date) = ?
              AND (amount = ? OR description LIKE ?)
            LIMIT 1
        `, [ret.shop_id, ret.return_date, oldAmount, `%${ret.product_name}%`]);

        if (txs.length > 0) {
            const txId = txs[0].id;
            await connection.query(
                `UPDATE shop_transactions 
                 SET amount = ?, description = ? 
                 WHERE id = ?`,
                [newAmount, `Product Return: ${product_name} (₹${newAmount})`, txId]
            );
        }

        // Ripple calculation starting from the return date
        const [dateRows] = await connection.query("SELECT DATE_FORMAT(?, '%Y-%m-%d') as tx_date", [ret.return_date]);
        const txDate = dateRows[0].tx_date;

        await financialService.rebuildRipple(connection, ret.shop_id, txDate);

        await connection.commit();
        cacheService.flush();

        res.json({ message: 'Product return updated successfully' });
    } catch (err) {
        await connection.rollback();
        console.error('editProductReturn error:', err);
        res.status(500).json({ error: err.message || 'Failed to update product return' });
    } finally {
        connection.release();
    }
};

/**
 * DELETE /api/collections/returns/:id
 * Admin-only: deletes an individual product return entry.
 */
exports.deleteProductReturn = async (req, res) => {
    if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'Admin')) {
        return res.status(403).json({ error: 'Access denied: Admin only' });
    }
    const { id } = req.params;

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Retrieve existing return row
        const [returns] = await connection.query(
            'SELECT shop_id, product_name, amount, return_date FROM product_returns WHERE id = ? FOR UPDATE',
            [id]
        );
        if (returns.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Product return entry not found' });
        }
        const ret = returns[0];
        const oldAmount = parseFloat(ret.amount);

        // Delete from product_returns
        await connection.query('DELETE FROM product_returns WHERE id = ?', [id]);

        // Locate and delete corresponding transaction in shop_transactions
        const [txs] = await connection.query(`
            SELECT id FROM shop_transactions
            WHERE shop_id = ? AND type = 'Return'
              AND DATE(transaction_date) = ?
              AND (amount = ? OR description LIKE ?)
            LIMIT 1
        `, [ret.shop_id, ret.return_date, oldAmount, `%${ret.product_name}%`]);

        if (txs.length > 0) {
            await connection.query('DELETE FROM shop_transactions WHERE id = ?', [txs[0].id]);
        }

        // Ripple calculation
        const [dateRows] = await connection.query("SELECT DATE_FORMAT(?, '%Y-%m-%d') as tx_date", [ret.return_date]);
        const txDate = dateRows[0].tx_date;

        await financialService.rebuildRipple(connection, ret.shop_id, txDate);

        await connection.commit();
        cacheService.flush();

        res.json({ message: 'Product return deleted successfully' });
    } catch (err) {
        await connection.rollback();
        console.error('deleteProductReturn error:', err);
        res.status(500).json({ error: err.message || 'Failed to delete product return' });
    } finally {
        connection.release();
    }
};

/**
 * POST /api/collections/transactions/add-retroactive
 * Admin-only: directly records an approved retroactive payment, adjustment, or return.
 */
exports.addRetroactiveTransaction = async (req, res) => {
    if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'Admin')) {
        return res.status(403).json({ error: 'Access denied: Admin only' });
    }
    const { shopId, type, amount, paymentMode, description, date } = req.body;

    if (!shopId || !type || amount === undefined || isNaN(parseFloat(amount)) || !date) {
        return res.status(400).json({ error: 'shopId, type, valid numeric amount, and date are required' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Retrieve shop
        const [shops] = await connection.query(
            'SELECT shop_name, village_name, order_line_id FROM shops WHERE id = ?',
            [shopId]
        );
        if (shops.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Shop not found' });
        }
        const shop = shops[0];

        const txType = type; // 'Payment' | 'Adjustment' | 'Return'
        const txAmount = parseFloat(amount);
        const txMode = (paymentMode || 'CASH').toUpperCase();
        const txCategory = txType === 'Payment' ? 'PAYMENT' : (txType === 'Adjustment' ? 'MANUAL_ADJUST' : 'RETURN');
        const txDesc = description || `${txType} Recorded`;

        // Format transaction datetime combining target date with actual current time
        const istNow = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
        const currentISTTime = istNow.toISOString().slice(11, 19); // HH:MM:SS
        const mysqlDate = `${date} ${currentISTTime}`;

        // Insert Transaction in shop_transactions
        await connection.query(`
            INSERT INTO shop_transactions 
                (shop_id, type, amount, payment_mode, payment_method, transaction_category, description, 
                 balance_after, approval_status, affects_balance, created_by, transaction_date) 
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'APPROVED', 1, 'Admin', ?)
        `, [shopId, txType, txAmount, txMode, txMode, txCategory, txDesc, mysqlDate]);

        // If it is a Return, also insert into product_returns
        if (txType === 'Return') {
            const productName = description ? description.replace('Product Return: ', '') : 'Returned Product';
            await connection.query(`
                INSERT INTO product_returns (shop_id, product_name, amount, created_by, return_date)
                VALUES (?, ?, ?, 'Admin', ?)
            `, [shopId, productName, txAmount, date]);
        }

        // Ripple calculation starting from the target date
        await financialService.rebuildRipple(connection, shopId, date);

        await connection.commit();
        cacheService.flush();

        res.json({ message: `${txType} recorded retroactively successfully` });
    } catch (err) {
        await connection.rollback();
        console.error('addRetroactiveTransaction error:', err);
        res.status(500).json({ error: err.message || 'Failed to add retroactive transaction' });
    } finally {
        connection.release();
    }
};
