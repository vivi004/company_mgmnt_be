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
        const [rows] = await db.query(`
            SELECT dc.*, ol.name AS order_line_name, ol.node_id
            FROM daily_collections dc
            JOIN order_lines ol ON dc.order_line_id = ol.id
            WHERE dc.order_line_id = ? AND dc.collection_date = ?
            ORDER BY dc.shop_name ASC
        `, [olId, date]);

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
