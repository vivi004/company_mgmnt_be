const db = require('../config/db');
const webhookService = require('../services/webhookService');

exports.createBill = async (req, res) => {
    const { shop_name, village_name, cart, custom_rates, created_by, bill_date, status, total_amount } = req.body;

    if (!shop_name || !village_name || !cart) {
        return res.status(400).json({
            message: 'Missing required fields',
            detail: 'Shop name, village name, and cart are required.'
        });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get the shop ID and current balance
        const [shops] = await connection.query(
            'SELECT id, balance FROM shops WHERE shop_name = ? AND village_name = ? FOR UPDATE',
            [shop_name, village_name]
        );

        if (shops.length === 0) {
            throw new Error(`Shop "${shop_name}" in "${village_name}" not found.`);
        }
        const shop = shops[0];

        // 2. Ensure app_settings exists
        await connection.query(`
            CREATE TABLE IF NOT EXISTS app_settings (
                id INT PRIMARY KEY,
                next_invoice_no INT NOT NULL DEFAULT 1001,
                last_invoice_no INT NOT NULL DEFAULT 1000,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        await connection.query(`
            INSERT IGNORE INTO app_settings (id, next_invoice_no, last_invoice_no)
            VALUES (1, 1001, 1000)
        `);

        // 3. Get and Lock the next invoice number
        const [rows] = await connection.query('SELECT next_invoice_no FROM app_settings WHERE id = 1 FOR UPDATE');
        let assignedInvoiceNo = rows[0]?.next_invoice_no || 1001;

        // 4. Prepare the date
        let mysqlDate;
        try {
            const d = bill_date ? new Date(bill_date) : new Date();
            if (isNaN(d.getTime())) throw new Error('Invalid date');
            mysqlDate = d.toISOString().slice(0, 19).replace('T', ' ');
        } catch (e) {
            mysqlDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
        }

        // 5. Insert the bill
        const cartJson = typeof cart === 'string' ? cart : JSON.stringify(cart);
        const ratesJson = typeof custom_rates === 'string' ? custom_rates : JSON.stringify(custom_rates || {});
        const amount = parseFloat(total_amount) || 0;

        const [billResult] = await connection.query(
            'INSERT INTO bills (invoice_no, shop_name, village_name, cart, custom_rates, created_by, bill_date, status, total_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [String(assignedInvoiceNo), shop_name, village_name, cartJson, ratesJson, created_by || 'Mobile App', mysqlDate, status || 'Unverified', amount]
        );

        // 6. Update Shop Balance
        const newBalance = parseFloat(shop.balance) + amount;
        await connection.query(
            'UPDATE shops SET balance = ? WHERE id = ?',
            [newBalance, shop.id]
        );

        // 7. Create Shop Transaction (Ledger Entry)
        await connection.query(
            'INSERT INTO shop_transactions (shop_id, type, amount, reference_id, description, balance_after, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [shop.id, 'Bill', amount, billResult.insertId, `Invoice #${assignedInvoiceNo}`, newBalance, created_by || 'Mobile App']
        );

        // 8. Increment the next invoice number
        await connection.query(
            'UPDATE app_settings SET next_invoice_no = next_invoice_no + 1, last_invoice_no = ? WHERE id = 1',
            [assignedInvoiceNo]
        );

        await connection.commit();

        // 9. Push to Webhook (Background)
        webhookService.sendTransactionToWebhook({
            shop_id: shop.id,
            shop_name: shop_name,
            village_name: village_name,
            type: 'Bill',
            amount: amount,
            description: `Invoice #${assignedInvoiceNo}`,
            balance_after: newBalance,
            created_by: created_by || 'Mobile App',
            reference_id: billResult.insertId
        });

        res.status(201).json({
            message: 'Bill created successfully',
            id: billResult.insertId,
            invoice_no: assignedInvoiceNo,
            new_balance: newBalance
        });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('CRITICAL ERROR during createBill:', err);
        res.status(500).json({
            message: `Failed to create bill: ${err.message}`,
            detail: err.message
        });
    } finally {
        if (connection) connection.release();
    }
};

exports.getAllBills = async (req, res) => {
    try {
        // Primary ledger = only verified bills
        const [rows] = await db.query(`
            SELECT b.*, MAX(s.phone) as phone, MAX(s.phone2) as phone2 
            FROM bills b 
            LEFT JOIN shops s ON b.shop_name = s.shop_name AND b.village_name = s.village_name 
            WHERE b.status = "Verified" 
            GROUP BY b.id
            ORDER BY b.bill_date DESC
        `);
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
        const [rows] = await db.query(`
            SELECT b.*, MAX(s.phone) as phone, MAX(s.phone2) as phone2 
            FROM bills b 
            LEFT JOIN shops s ON b.shop_name = s.shop_name AND b.village_name = s.village_name 
            WHERE b.status = "Unverified" 
            GROUP BY b.id
            ORDER BY b.bill_date DESC
        `);
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
        let query = `
            SELECT b.*, MAX(s.phone) as phone, MAX(s.phone2) as phone2 
            FROM bills b 
            LEFT JOIN shops s ON b.shop_name = s.shop_name AND b.village_name = s.village_name 
            WHERE b.status = "Verified"
        `;
        const params = [];

        if (startDate) {
            query += ' AND b.bill_date >= ?';
            params.push(startDate);
        }
        if (endDate) {
            // Add 1 day to endDate to include the full end day
            const end = new Date(endDate);
            end.setDate(end.getDate() + 1);
            query += ' AND b.bill_date < ?';
            params.push(end.toISOString().split('T')[0]);
        }

        query += ' GROUP BY b.id ORDER BY b.bill_date DESC';

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
