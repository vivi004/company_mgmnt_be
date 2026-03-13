const db = require('../config/db');

exports.createBill = async (req, res) => {
    const { invoice_no, shop_name, village_name, cart, custom_rates, created_by, bill_date, status } = req.body;
    try {
        // Convert ISO 8601 date to MySQL DATETIME format (YYYY-MM-DD HH:MM:SS)
        const mysqlDate = bill_date
            ? new Date(bill_date).toISOString().slice(0, 19).replace('T', ' ')
            : new Date().toISOString().slice(0, 19).replace('T', ' ');

        const [result] = await db.query(
            'INSERT INTO bills (invoice_no, shop_name, village_name, cart, custom_rates, created_by, bill_date, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [invoice_no, shop_name, village_name, JSON.stringify(cart), JSON.stringify(custom_rates || {}), created_by, mysqlDate, status || 'Unverified']
        );
        res.status(201).json({ message: 'Bill created successfully', id: result.insertId, invoice_no });
    } catch (err) {
        console.error('Error creating bill:', err.message || err);
        res.status(500).json({ error: 'Failed to create bill', detail: err.message });
    }
};

exports.getAllBills = async (req, res) => {
    try {
        // Primary ledger = only verified bills
        const [rows] = await db.query('SELECT * FROM bills WHERE status = "Verified" ORDER BY bill_date DESC');
        const mapped = rows.map(row => {
            let cart = row.cart;
            let custom_rates = row.custom_rates;
            try { if (typeof cart === 'string') cart = JSON.parse(cart); } catch { cart = {}; }
            try { if (typeof custom_rates === 'string') custom_rates = JSON.parse(custom_rates); } catch { custom_rates = {}; }
            return { ...row, cart, custom_rates };
        });
        res.json(mapped);
    } catch (err) {
        console.error('Error fetching bills:', err.message || err);
        res.status(500).json({ error: 'Failed to fetch bills', detail: err.message });
    }
};

exports.getUnverifiedBills = async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM bills WHERE status = "Unverified" ORDER BY bill_date DESC');
        const mapped = rows.map(row => {
            let cart = row.cart;
            let custom_rates = row.custom_rates;
            try { if (typeof cart === 'string') cart = JSON.parse(cart); } catch { cart = {}; }
            try { if (typeof custom_rates === 'string') custom_rates = JSON.parse(custom_rates); } catch { custom_rates = {}; }
            return { ...row, cart, custom_rates };
        });
        res.json(mapped);
    } catch (err) {
        console.error('Error fetching unverified bills:', err.message || err);
        res.status(500).json({ error: 'Failed to fetch unverified bills', detail: err.message });
    }
};

exports.verifyBill = async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('UPDATE bills SET status = "Verified" WHERE id = ?', [id]);
        res.json({ message: 'Bill verified successfully' });
    } catch (err) {
        console.error('Error verifying bill:', err);
        res.status(500).json({ error: 'Failed to verify bill' });
    }
};

exports.deleteBill = async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('DELETE FROM bills WHERE id = ?', [id]);
        res.json({ message: 'Bill deleted successfully' });
    } catch (err) {
        console.error('Error deleting bill:', err);
        res.status(500).json({ error: 'Failed to delete bill' });
    }
};

exports.updateBill = async (req, res) => {
    const { id } = req.params;
    const { cart, custom_rates } = req.body;
    try {
        await db.query(
            'UPDATE bills SET cart = ?, custom_rates = ? WHERE id = ?',
            [JSON.stringify(cart), JSON.stringify(custom_rates || {}), id]
        );
        res.json({ message: 'Bill updated successfully' });
    } catch (err) {
        console.error('Error updating bill:', err);
        res.status(500).json({ error: 'Failed to update bill' });
    }
};

exports.getBillsByDateRange = async (req, res) => {
    const { startDate, endDate } = req.query;
    try {
        let query = 'SELECT * FROM bills WHERE status = "Verified"';
        const params = [];

        if (startDate) {
            query += ' AND bill_date >= ?';
            params.push(startDate);
        }
        if (endDate) {
            // Add 1 day to endDate to include the full end day
            const end = new Date(endDate);
            end.setDate(end.getDate() + 1);
            query += ' AND bill_date < ?';
            params.push(end.toISOString().split('T')[0]);
        }

        query += ' ORDER BY bill_date DESC';

        const [rows] = await db.query(query, params);
        const mapped = rows.map(row => {
            let cart = row.cart;
            let custom_rates = row.custom_rates;
            try { if (typeof cart === 'string') cart = JSON.parse(cart); } catch { cart = {}; }
            try { if (typeof custom_rates === 'string') custom_rates = JSON.parse(custom_rates); } catch { custom_rates = {}; }
            return { ...row, cart, custom_rates };
        });
        res.json(mapped);
    } catch (err) {
        console.error('Error fetching bills by date range:', err.message || err);
        res.status(500).json({ error: 'Failed to fetch bills by date range', detail: err.message });
    }
};
