const db = require('../config/db');
const { validationResult } = require('express-validator');
const webhookService = require('../services/webhookService');

// GET all shops for a specific order_line (village)
const getShopsByOrderLine = async (req, res) => {
    const { order_line_id } = req.params;
    try {
        const [shops] = await db.query(
            `SELECT s.id, s.order_line_id, s.shop_name, s.village_name, s.owner_name, s.shop_owner, s.phone, s.phone2, s.balance, s.created_at,
                    CAST(EXISTS(
                        SELECT 1 FROM bills b 
                        WHERE b.shop_name = s.shop_name 
                        AND b.village_name = s.village_name
                        AND DATE(b.created_at) = CURDATE()
                    ) AS UNSIGNED) as has_order_today
             FROM shops s 
             WHERE s.order_line_id = ? 
             ORDER BY s.shop_name ASC`,
            [order_line_id]
        );
        res.json(shops);
    } catch (err) {
        console.error('getShopsByOrderLine error:', err);
        res.status(500).json({ error: 'Failed to fetch shops' });
    }
};

// GET all shops
const getAllShops = async (req, res) => {
    try {
        const [shops] = await db.query(
            `SELECT s.id, s.order_line_id, s.shop_name, s.village_name, s.owner_name, s.shop_owner, s.phone, s.phone2, s.balance, s.created_at,
                    ol.name AS ol_village_name, ol.node_id
             FROM shops s
             JOIN order_lines ol ON s.order_line_id = ol.id
             ORDER BY ol.name ASC, s.shop_name ASC`
        );
        res.json(shops);
    } catch (err) {
        console.error('getAllShops error:', err);
        res.status(500).json({ error: 'Failed to fetch shops' });
    }
};

// CREATE a shop
const createShop = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { order_line_id, shop_name, village_name, owner_name, shop_owner, phone, phone2, balance } = req.body;
    try {
        const startBalance = parseFloat(balance) || 0;
        const [result] = await db.query(
            `INSERT INTO shops (order_line_id, shop_name, village_name, owner_name, shop_owner, phone, phone2, balance) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [order_line_id, shop_name, village_name || '', owner_name || '', shop_owner || '', phone || '', phone2 || '', startBalance]
        );

        // Push "Opening Balance" to Webhook
        webhookService.sendTransactionToWebhook({
            shop_id: result.insertId,
            shop_name: shop_name,
            village_name: village_name || '',
            type: 'Registration',
            amount: startBalance,
            description: 'Shop Registered (Opening Balance)',
            balance_before: 0,
            balance_after: startBalance,
            created_by: 'System'
        });

        res.status(201).json({ id: result.insertId, message: 'Shop created successfully' });
    } catch (err) {
        console.error('createShop error:', err);
        res.status(500).json({ error: 'Failed to create shop' });
    }
};

// UPDATE a shop
const updateShop = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { id } = req.params;
    const { shop_name, village_name, owner_name, shop_owner, phone, phone2, balance } = req.body;
    try {
        await db.query(
            `UPDATE shops SET shop_name = ?, village_name = ?, owner_name = ?, shop_owner = ?, phone = ?, phone2 = ?, balance = ? WHERE id = ?`,
            [shop_name, village_name || '', owner_name || '', shop_owner || '', phone || '', phone2 || '', balance || 0, id]
        );
        res.json({ message: 'Shop updated successfully' });
    } catch (err) {
        console.error('updateShop error:', err);
        res.status(500).json({ error: 'Failed to update shop' });
    }
};

// DELETE a shop
const deleteShop = async (req, res) => {
    const { id } = req.params;
    try {
        // Fetch details before deletion for the log
        const [shops] = await db.query('SELECT shop_name, village_name, balance FROM shops WHERE id = ?', [id]);
        if (shops.length > 0) {
            const shop = shops[0];
            // Log deletion to Webhook
            webhookService.sendTransactionToWebhook({
                shop_id: id,
                shop_name: shop.shop_name,
                village_name: shop.village_name,
                type: 'Deletion',
                amount: 0,
                description: 'Shop Deleted / Account Closed',
                balance_after: 0,
                created_by: 'Admin'
            });
        }
        await db.query(`DELETE FROM shops WHERE id = ?`, [id]);
        res.json({ message: 'Shop deleted successfully' });
    } catch (err) {
        console.error('deleteShop error:', err);
        res.status(500).json({ error: 'Failed to delete shop' });
    }
};

// Sync All Shops to Ledger (One-time export)
const syncAllShopsToLedger = async (req, res) => {
    try {
        const [shops] = await db.query('SELECT id, shop_name, village_name, balance FROM shops');
        
        // Split into batches of 100 to prevent timeouts
        const BATCH_SIZE = 100;
        for (let i = 0; i < shops.length; i += BATCH_SIZE) {
            const batch = shops.slice(i, i + BATCH_SIZE);
            const bulkData = batch.map(shop => ({
                shop_id: shop.id,
                shop_name: shop.shop_name,
                village_name: shop.village_name,
                type: 'Opening Balance',
                amount: parseFloat(shop.balance),
                description: 'Initial Bulk Sync',
                balance_after: parseFloat(shop.balance),
                created_by: 'Admin Sync',
                payment_method: 'Opening Balance',
                timestamp: new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000).toISOString().replace('T', ' ').split('.')[0]
            }));

            // Send this batch
            await webhookService.sendTransactionToWebhook(bulkData);
            console.log(`Synced batch ${Math.floor(i/BATCH_SIZE) + 1} of ${Math.ceil(shops.length/BATCH_SIZE)}`);
        }
        
        res.json({ message: `Successfully pushed ${shops.length} shops to ledger in batches.` });
    } catch (err) {
        console.error('syncAllShopsToLedger error:', err);
        res.status(500).json({ error: `Sync failed: ${err.message}` });
    }
};

// POST Collect Payment
const collectPayment = async (req, res) => {
    const { id } = req.params;
    const { amount, payment_method, description, created_by } = req.body;

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [shops] = await connection.query('SELECT id, shop_name, village_name, balance FROM shops WHERE id = ? FOR UPDATE', [id]);
        if (shops.length === 0) throw new Error('Shop not found');
        const shop = shops[0];

        const payAmount = parseFloat(amount);
        const newBalance = parseFloat(shop.balance) - payAmount;

        await connection.query('UPDATE shops SET balance = ? WHERE id = ?', [newBalance, id]);

        const mysqlDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
        await connection.query(
            'INSERT INTO shop_transactions (shop_id, type, amount, payment_method, description, balance_after, created_by, transaction_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [id, 'Payment', payAmount, payment_method || 'Cash', description || 'Payment Received', newBalance, created_by || 'Staff', mysqlDate]
        );

        await connection.commit();

        // Push to Webhook
        webhookService.sendTransactionToWebhook({
            shop_id: id,
            shop_name: shop.shop_name,
            village_name: shop.village_name,
            type: 'Payment',
            amount: -payAmount,
            payment_method: payment_method || 'Cash',
            description: description || 'Payment Received',
            balance_before: parseFloat(shop.balance) || 0,
            balance_after: newBalance,
            created_by: created_by || 'Staff'
        });
        res.json({ message: 'Payment recorded successfully', new_balance: newBalance });
    } catch (err) {
        if (connection) await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) connection.release();
    }
};

// GET Shop Ledger
const getShopLedger = async (req, res) => {
    const { id } = req.params;
    const limit = parseInt(req.query.limit) || 20;
    const skip = parseInt(req.query.skip) || 0;
    try {
        const [transactions] = await db.query(
            'SELECT * FROM shop_transactions WHERE shop_id = ? ORDER BY transaction_date DESC, id DESC LIMIT ? OFFSET ?',
            [id, limit, skip]
        );
        res.json(transactions);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch ledger' });
    }
};

// POST Adjust Balance (Admin only)
const adjustBalance = async (req, res) => {
    const { id } = req.params;
    const { amount, type, description, created_by } = req.body; // type: 'Adjustment'

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [shops] = await connection.query('SELECT id, shop_name, village_name, balance FROM shops WHERE id = ? FOR UPDATE', [id]);
        if (shops.length === 0) throw new Error('Shop not found');
        const shop = shops[0];

        const adjAmount = parseFloat(amount);
        const newBalance = parseFloat(shop.balance) + adjAmount; // amount can be negative

        await connection.query('UPDATE shops SET balance = ? WHERE id = ?', [newBalance, id]);

        const mysqlDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
        await connection.query(
            'INSERT INTO shop_transactions (shop_id, type, amount, description, balance_after, created_by, transaction_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [id, 'Adjustment', adjAmount, description || 'Manual Adjustment', newBalance, created_by || 'Admin', mysqlDate]
        );

        await connection.commit();

        // Push to Webhook
        webhookService.sendTransactionToWebhook({
            shop_id: id,
            shop_name: shop.shop_name,
            village_name: shop.village_name,
            type: 'Adjustment',
            amount: adjAmount,
            description: description || 'Manual Adjustment',
            balance_before: parseFloat(shop.balance) || 0,
            balance_after: newBalance,
            created_by: created_by || 'Admin'
        });
        res.json({ message: 'Balance adjusted successfully', new_balance: newBalance });
    } catch (err) {
        if (connection) await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) connection.release();
    }
};

module.exports = { 
    getShopsByOrderLine, 
    getAllShops, 
    createShop, 
    updateShop, 
    deleteShop,
    collectPayment,
    getShopLedger,
    adjustBalance,
    syncAllShopsToLedger
};
