const db = require('../config/db');

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
    try {
        const [rows] = await db.query(`
            SELECT dc.*, ol.name AS order_line_name, ol.node_id
            FROM daily_collections dc
            JOIN order_lines ol ON dc.order_line_id = ol.id
            WHERE dc.collection_date = ?
            ORDER BY ol.name ASC, dc.shop_name ASC
        `, [date]);
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

    try {
        // This robust query fetches ALL shops for the order line.
        const [rows] = await db.query(`
            SELECT 
                s.id AS shop_id,
                s.shop_name,
                s.village_name,
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
                
                -- APPROVED Manual Adjustment Breakdown
                COALESCE(adj.m_cash, 0) AS manual_cash,
                COALESCE(adj.m_upi, 0) AS manual_upi,
                COALESCE(adj.m_cheque, 0) AS manual_cheque,
                COALESCE(adj.m_pos, 0) AS manual_pos,

                -- PENDING Transactions for the row
                COALESCE(pt.pending_json, '[]') AS pending_transactions,

                -- The PREV BAL logic
                COALESCE(dc.old_balance, COALESCE(prev.total_balance, 0)) AS old_balance,

                -- The TOTAL BAL logic
                COALESCE(
                    dc.total_balance,
                    COALESCE(prev.total_balance, 0) + COALESCE(dc.todays_bill_amount, 0) - (COALESCE(dc.cash_collected, 0) + COALESCE(dc.upi_collected, 0) + COALESCE(dc.cheque_collected, 0)) + COALESCE(dc.manual_adjustments, 0)
                ) AS total_balance
            FROM shops s
            JOIN order_lines ol ON s.order_line_id = ol.id
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
                    SUM(CASE WHEN amount < 0 AND type = 'Adjustment' AND payment_mode = 'CASH' THEN ABS(amount) ELSE 0 END) as m_cash,
                    SUM(CASE WHEN amount < 0 AND type = 'Adjustment' AND payment_mode = 'UPI' THEN ABS(amount) ELSE 0 END) as m_upi,
                    SUM(CASE WHEN amount < 0 AND type = 'Adjustment' AND payment_mode = 'CHEQUE' THEN ABS(amount) ELSE 0 END) as m_cheque,
                    SUM(CASE WHEN amount > 0 AND type = 'Adjustment' THEN amount ELSE 0 END) as m_pos
                FROM shop_transactions
                WHERE approval_status = 'APPROVED' AND DATE(transaction_date) = ?
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
                WHERE approval_status = 'PENDING'
                GROUP BY shop_id
            ) pt ON s.id = pt.shop_id
            WHERE s.order_line_id = ?
            ORDER BY s.shop_name ASC
        `, [date, date, date, date, olId]);

        // FETCH EXPENSES
        const [expRows] = await db.query(`
            SELECT * FROM daily_expenses
            WHERE order_line_id = ? AND expense_date = ?
        `, [olId, date]);

        res.json({
            collections: rows,
            expenses: expRows
        });
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
        res.json({ message: 'Expense deleted successfully' });
    } catch (err) {
        console.error('deleteExpense error:', err);
        res.status(500).json({ error: 'Failed to delete expense' });
    }
};
