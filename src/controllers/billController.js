const db = require('../config/db');
const webhookService = require('../services/webhookService');

exports.createBill = async (req, res) => {
    const { shop_name, village_name, cart, custom_rates, created_by, bill_date, status, total_amount, delivery_date } = req.body;

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
        
        let mysqlDeliveryDate = null;
        if (delivery_date) {
            try {
                const d = new Date(delivery_date);
                if (!isNaN(d.getTime())) {
                    mysqlDeliveryDate = d.toISOString().slice(0, 19).replace('T', ' ');
                }
            } catch(e) {}
        }

        // 5. Insert the bill
        const cartJson = typeof cart === 'string' ? cart : JSON.stringify(cart);
        const ratesJson = typeof custom_rates === 'string' ? custom_rates : JSON.stringify(custom_rates || {});
        const amount = parseFloat(total_amount) || 0;

        const [billResult] = await connection.query(
            'INSERT INTO bills (invoice_no, shop_name, village_name, cart, custom_rates, created_by, bill_date, delivery_date, status, total_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [String(assignedInvoiceNo), shop_name, village_name, cartJson, ratesJson, created_by || 'Mobile App', mysqlDate, mysqlDeliveryDate, status || 'Unverified', amount]
        );

        // 6. Update Shop Balance
        const newBalance = parseFloat(shop.balance) + amount;
        await connection.query(
            'UPDATE shops SET balance = ? WHERE id = ?',
            [newBalance, shop.id]
        );

        // 7. Create Shop Transaction (Ledger Entry)
        await connection.query(
            'INSERT INTO shop_transactions (shop_id, type, amount, reference_id, description, balance_after, created_by, transaction_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [shop.id, 'Bill', amount, billResult.insertId, `Invoice #${assignedInvoiceNo}`, newBalance, created_by || 'Mobile App', mysqlDeliveryDate || mysqlDate]
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
            balance_before: shop.balance,
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
            ORDER BY COALESCE(b.delivery_date, b.bill_date) DESC, b.id DESC
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
            ORDER BY COALESCE(b.delivery_date, b.bill_date) DESC, b.id DESC
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
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get bill details
        const [bills] = await connection.query('SELECT shop_name, village_name, total_amount, invoice_no, created_by FROM bills WHERE id = ?', [id]);
        if (bills.length === 0) throw new Error('Bill not found');
        const bill = bills[0];

        // 2. Get shop details
        const [shops] = await connection.query('SELECT id, balance FROM shops WHERE shop_name = ? AND village_name = ? FOR UPDATE', [bill.shop_name, bill.village_name]);
        if (shops.length > 0) {
            const shop = shops[0];
            const amount = parseFloat(bill.total_amount);
            const newBalance = parseFloat(shop.balance) - amount;

            // 3. Update shop balance
            await connection.query('UPDATE shops SET balance = ? WHERE id = ?', [newBalance, shop.id]);

            // 4. Create "Cancellation" Ledger Entry
            await connection.query(
                'INSERT INTO shop_transactions (shop_id, type, amount, reference_id, description, balance_after, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [shop.id, 'Adjustment', -amount, id, `Cancelled Invoice #${bill.invoice_no}`, newBalance, bill.created_by || 'Admin']
            );

            // 5. Push to Webhook
            webhookService.sendTransactionToWebhook({
                shop_id: shop.id,
                shop_name: bill.shop_name,
                village_name: bill.village_name,
                type: 'Cancellation',
                amount: -amount,
                description: `Cancelled Invoice #${bill.invoice_no}`,
                balance_before: parseFloat(shop.balance),
                balance_after: newBalance,
                created_by: bill.created_by || 'Admin'
            });
        }

        // 6. Delete the bill
        await connection.query('DELETE FROM bills WHERE id = ?', [id]);

        await connection.commit();
        res.json({ message: 'Bill deleted and balance reversed successfully' });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error deleting bill:', err);
        res.status(500).json({ error: 'Failed to delete bill' });
    } finally {
        if (connection) connection.release();
    }
};

exports.updateBill = async (req, res) => {
    const { id } = req.params;
    const { cart, custom_rates, total_amount } = req.body;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get old bill details
        const [bills] = await connection.query('SELECT shop_name, village_name, total_amount, invoice_no, created_by FROM bills WHERE id = ? FOR UPDATE', [id]);
        if (bills.length === 0) throw new Error('Bill not found');
        const bill = bills[0];

        // 2. Calculate difference
        const oldAmount = parseFloat(bill.total_amount);
        const newAmount = parseFloat(total_amount);
        const diff = newAmount - oldAmount;

        // 3. Update shop balance if there's a difference
        if (diff !== 0) {
            const [shops] = await connection.query('SELECT id, balance FROM shops WHERE shop_name = ? AND village_name = ? FOR UPDATE', [bill.shop_name, bill.village_name]);
            if (shops.length > 0) {
                const shop = shops[0];
                const newBalance = parseFloat(shop.balance) + diff;
                await connection.query('UPDATE shops SET balance = ? WHERE id = ?', [newBalance, shop.id]);

                // 4. Create Ledger Entry for adjustment
                await connection.query(
                    'INSERT INTO shop_transactions (shop_id, type, amount, reference_id, description, balance_after, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [shop.id, 'Adjustment', diff, id, `Update Invoice #${bill.invoice_no}`, newBalance, bill.created_by || 'Admin']
                );

                // 5. Push to Webhook
                webhookService.sendTransactionToWebhook({
                    shop_id: shop.id,
                    shop_name: bill.shop_name,
                    village_name: bill.village_name,
                    type: 'Adjustment',
                    amount: diff,
                    description: `Update Invoice #${bill.invoice_no}`,
                    balance_before: parseFloat(shop.balance),
                    balance_after: newBalance,
                    created_by: bill.created_by || 'Admin'
                });
            }
        }

        // 6. Update the bill
        let mysqlDeliveryDate = null;
        if (req.body.delivery_date) {
            try {
                const d = new Date(req.body.delivery_date);
                if (!isNaN(d.getTime())) {
                    mysqlDeliveryDate = d.toISOString().slice(0, 19).replace('T', ' ');
                }
            } catch(e) {}
        }

        await connection.query(
            'UPDATE bills SET cart = ?, custom_rates = ?, total_amount = ?, delivery_date = ? WHERE id = ?',
            [JSON.stringify(cart), JSON.stringify(custom_rates || {}), newAmount, mysqlDeliveryDate, id]
        );

        // 7. Update transaction date in ledger if it exists for this bill
        if (mysqlDeliveryDate) {
            await connection.query(
                'UPDATE shop_transactions SET transaction_date = ? WHERE reference_id = ? AND type = "Bill"',
                [mysqlDeliveryDate, id]
            );
        }

        await connection.commit();
        res.json({ message: 'Bill updated and balance adjusted successfully' });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error updating bill:', err);
        res.status(500).json({ error: 'Failed to update bill' });
    } finally {
        if (connection) connection.release();
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
