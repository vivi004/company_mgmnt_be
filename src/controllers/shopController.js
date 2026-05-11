const db = require('../config/db');
const { validationResult } = require('express-validator');
const webhookService = require('../services/webhookService');

/**
 * AUTO-LAND BILLS: Moves money from future bills to active shop balances 
 * when the delivery date arrives (midnight).
 */
async function autoLandBills(connection) {
    // 1. Move money to shop balances for bills that have reached their delivery date
    await connection.query(`
        UPDATE shops s
        SET s.balance = s.balance + (
            SELECT COALESCE(SUM(total_amount), 0)
            FROM bills b
            WHERE b.shop_id = s.id 
            AND b.is_applied_to_balance = 0 
            AND DATE(b.delivery_date) <= CURDATE()
        )
        WHERE EXISTS (
            SELECT 1 FROM bills b 
            WHERE b.shop_id = s.id 
            AND b.is_applied_to_balance = 0 
            AND DATE(b.delivery_date) <= CURDATE()
        )
    `);

    // 2. Mark those bills as 'Applied' so we don't count them again
    await connection.query(`
        UPDATE bills SET is_applied_to_balance = 1 
        WHERE is_applied_to_balance = 0 
        AND DATE(delivery_date) <= CURDATE()
    `);
}

// GET all shops for a specific order_line (village)
const getShopsByOrderLine = async (req, res) => {
    const { order_line_id } = req.params;
    const connection = await db.getConnection();
    try {
        await autoLandBills(connection);
        const [shops] = await connection.query(
            `SELECT s.id, s.order_line_id, s.shop_name, s.village_name, s.owner_name, s.shop_owner, s.phone, s.phone2, s.balance, s.created_at,
                    CAST(EXISTS(
                        SELECT 1 FROM bills b 
                        WHERE b.shop_id = s.id
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
    } finally {
        if (connection) connection.release();
    }
};

// GET all shops
const getAllShops = async (req, res) => {
    const connection = await db.getConnection();
    try {
        await autoLandBills(connection);
        const [shops] = await connection.query(
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
    } finally {
        if (connection) connection.release();
    }
};

// CREATE a shop
const createShop = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    let { order_line_id, shop_name, village_name, owner_name, shop_owner, phone, phone2, balance, created_by } = req.body;
    try {
        // Safety check: If created_by is missing, fetch the acting user's name from the DB
        if (!created_by && req.user && req.user.id) {
            try {
                const [users] = await db.query('SELECT first_name, last_name FROM employees WHERE id = ?', [req.user.id]);
                if (users.length > 0) {
                    created_by = `${users[0].first_name} ${users[0].last_name || ''}`.trim();
                }
            } catch (e) {
                console.error('Failed to fetch user name for shop creation:', e);
            }
        }

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
            created_by: created_by || 'System'
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
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Fetch current shop to check for balance and name changes
        const [oldShops] = await connection.query('SELECT shop_name, village_name, balance, order_line_id FROM shops WHERE id = ? FOR UPDATE', [id]);
        if (oldShops.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Shop not found' });
        }
        
        const oldShop = oldShops[0];
        const oldBalance = parseFloat(oldShop.balance) || 0;
        const newBalance = parseFloat(balance) || 0;

        // 1. Update the shop record
        await connection.query(
            `UPDATE shops SET shop_name = ?, village_name = ?, owner_name = ?, shop_owner = ?, phone = ?, phone2 = ?, balance = ? WHERE id = ?`,
            [shop_name, village_name || '', owner_name || '', shop_owner || '', phone || '', phone2 || '', newBalance, id]
        );

        // 2. If name or village changed, update ALL related bills to prevent orphans
        // We now have shop_id, so we update by ID which is 100% reliable
        if (oldShop.shop_name !== shop_name || oldShop.village_name !== village_name) {
            await connection.query(
                'UPDATE bills SET shop_name = ?, village_name = ? WHERE shop_id = ?',
                [shop_name, village_name || '', id]
            );
        }

        // 3. If balance was changed manually, log it
        if (oldBalance !== newBalance) {
            let actingUserName = 'Admin';
            if (req.user && req.user.id) {
                const [users] = await connection.query('SELECT first_name, last_name FROM employees WHERE id = ?', [req.user.id]);
                if (users.length > 0) {
                    actingUserName = `${users[0].first_name} ${users[0].last_name || ''}`.trim();
                }
            }

            const mysqlDate = new Date();
            await connection.query(
                'INSERT INTO shop_transactions (shop_id, type, amount, description, balance_after, created_by, transaction_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [id, 'Adjustment', newBalance - oldBalance, 'Manual Balance Update (Edit Shop)', newBalance, actingUserName, mysqlDate]
            );

            // Update daily_collections for this manual edit
            const [dateRows] = await connection.query("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d') as today");
            const todayIST = dateRows[0].today;

            // "Zero-Drift" Sync: Subtract any bills with a FUTURE delivery date so they don't affect Today's dashboard balance
            const [futureRows] = await connection.query(
                "SELECT COALESCE(SUM(total_amount), 0) as future_amount FROM bills WHERE shop_id = ? AND delivery_date > ?",
                [id, todayIST + ' 23:59:59']
            );
            const futureAmount = parseFloat(futureRows[0].future_amount);
            const dashboardBalance = newBalance - futureAmount;

            await connection.query(`
                INSERT INTO daily_collections
                    (shop_id, shop_name, village_name, order_line_id, collection_date,
                     old_balance, total_balance)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    total_balance = VALUES(total_balance)
            `, [id, shop_name, village_name || '', oldShop.order_line_id, todayIST, oldBalance, dashboardBalance]);

            webhookService.sendTransactionToWebhook({
                shop_id: id,
                shop_name: shop_name,
                village_name: village_name || '',
                type: 'Adjustment',
                amount: newBalance - oldBalance,
                description: 'Manual Balance Update (Edit Shop)',
                balance_before: oldBalance,
                balance_after: newBalance,
                created_by: actingUserName
            });
        }

        await connection.commit();
        res.json({ message: 'Shop and related records updated successfully' });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('updateShop error:', err);
        res.status(500).json({ error: 'Failed to update shop' });
    } finally {
        if (connection) connection.release();
    }
};

// DELETE a shop
const deleteShop = async (req, res) => {
    const { id } = req.params;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Fetch details before deletion for the log
        const [shops] = await connection.query('SELECT shop_name, village_name, balance FROM shops WHERE id = ? FOR UPDATE', [id]);
        if (shops.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Shop not found' });
        }
        
        const shop = shops[0];

        // 2. Log deletion to Webhook (Background)
        let actingUserName = 'Admin';
        try {
            const [users] = await connection.query('SELECT first_name, last_name FROM employees WHERE id = ?', [req.user.id]);
            if (users.length > 0) {
                actingUserName = `${users[0].first_name} ${users[0].last_name || ''}`.trim();
            }
        } catch (e) {
            console.error('Failed to fetch user name for shop deletion:', e);
        }

        webhookService.sendTransactionToWebhook({
            shop_id: id,
            shop_name: shop.shop_name,
            village_name: shop.village_name,
            type: 'Deletion',
            amount: 0,
            description: 'Shop Deleted / Account Closed',
            balance_before: parseFloat(shop.balance),
            balance_after: 0,
            created_by: actingUserName
        });

        // 3. Delete related records to prevent orphans
        // Delete transactions
        await connection.query('DELETE FROM shop_transactions WHERE shop_id = ?', [id]);
        
        // Delete bills (Now using shop_id for precise deletion)
        await connection.query('DELETE FROM bills WHERE shop_id = ?', [id]);

        // 4. Finally delete the shop
        await connection.query('DELETE FROM shops WHERE id = ?', [id]);

        await connection.commit();
        res.json({ message: 'Shop and all associated records deleted successfully' });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('deleteShop error:', err);
        res.status(500).json({ error: 'Failed to delete shop completely' });
    } finally {
        if (connection) connection.release();
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
                timestamp: new Date()
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
    let { amount, payment_method, description, created_by } = req.body;

    // Safety check: If created_by is missing, fetch the acting user's name from the DB
    if (!created_by && req.user && req.user.id) {
        try {
            const [users] = await db.query('SELECT first_name, last_name FROM employees WHERE id = ?', [req.user.id]);
            if (users.length > 0) {
                created_by = `${users[0].first_name} ${users[0].last_name || ''}`.trim();
            }
        } catch (e) {
            console.error('Failed to fetch user name for payment collection:', e);
        }
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [shops] = await connection.query('SELECT id, shop_name, village_name, balance, order_line_id FROM shops WHERE id = ? FOR UPDATE', [id]);
        if (shops.length === 0) throw new Error('Shop not found');
        const shop = shops[0];

        // Self-Healing: If order_line_id is missing, try to find it by village name
        let shopOrderLineId = shop.order_line_id;
        if (!shopOrderLineId) {
            const [ols] = await connection.query('SELECT id FROM order_lines WHERE TRIM(name) = TRIM(?) LIMIT 1', [shop.village_name]);
            if (ols.length > 0) {
                shopOrderLineId = ols[0].id;
                await connection.query('UPDATE shops SET order_line_id = ? WHERE id = ?', [shopOrderLineId, id]);
                console.log(`Self-healed shop ${id}: Linked to order_line ${shopOrderLineId}`);
            }
        }
        if (!shopOrderLineId) throw new Error("Shop is not linked to any Order Line. Please edit the shop and select a Village first.");

        const payAmount = parseFloat(amount);
        const newBalance = parseFloat(shop.balance) - payAmount;

        await connection.query('UPDATE shops SET balance = ? WHERE id = ?', [newBalance, id]);

        const mysqlDate = new Date();
        await connection.query(
            'INSERT INTO shop_transactions (shop_id, type, amount, payment_method, description, balance_after, created_by, transaction_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [id, 'Payment', payAmount, payment_method || 'Cash', description || 'Payment Received', newBalance, created_by || 'Staff', mysqlDate]
        );

        // Update daily_collections for this payment
        const { cash_amount, upi_amount, cheque_amount } = req.body;
        const payMethod = (payment_method || 'Cash').toLowerCase();
        
        // Bulletproof Date Logic: Use the same format as billing
        const [dateRows] = await connection.query("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d') as today");
        const todayIST = dateRows[0].today;

        // "Zero-Drift" Sync: Subtract any bills with a FUTURE delivery date so they don't affect Today's dashboard balance
        const [futureRows] = await connection.query(
            "SELECT COALESCE(SUM(total_amount), 0) as future_amount FROM bills WHERE shop_id = ? AND delivery_date > ?",
            [id, todayIST + ' 23:59:59']
        );
        const futureAmount = parseFloat(futureRows[0].future_amount);
        const dashboardBalance = newBalance - futureAmount;

        if (cash_amount !== undefined || upi_amount !== undefined || cheque_amount !== undefined) {
            // Precise split amounts provided
            const c = parseFloat(cash_amount) || 0;
            const u = parseFloat(upi_amount) || 0;
            const q = parseFloat(cheque_amount) || 0;

            await connection.query(`
                INSERT INTO daily_collections
                    (shop_id, shop_name, village_name, order_line_id, collection_date,
                     cash_collected, upi_collected, cheque_collected, old_balance, total_balance)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    cash_collected = cash_collected + VALUES(cash_collected),
                    upi_collected = upi_collected + VALUES(upi_collected),
                    cheque_collected = cheque_collected + VALUES(cheque_collected),
                    total_balance = VALUES(total_balance)
            `, [id, shop.shop_name, shop.village_name, shopOrderLineId,
                todayIST, c, u, q, parseFloat(shop.balance), dashboardBalance]);
        } else {
            // Fallback to single mode detection
            const payMethod = (payment_method || 'Cash').toLowerCase();
            const columnToUpdate = (payMethod.includes('upi') || payMethod.includes('gpay') || 
                payMethod.includes('phonepe') || payMethod.includes('paytm')) ? 'upi_collected' : (payMethod.includes('cheque') || payMethod.includes('check') ? 'cheque_collected' : 'cash_collected');

            await connection.query(`
                INSERT INTO daily_collections
                    (shop_id, shop_name, village_name, order_line_id, collection_date,
                     ${columnToUpdate}, old_balance, total_balance)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    ${columnToUpdate} = ${columnToUpdate} + VALUES(${columnToUpdate}),
                    total_balance = VALUES(total_balance)
            `, [id, shop.shop_name, shop.village_name, shopOrderLineId,
                todayIST, payAmount, parseFloat(shop.balance), dashboardBalance]);
        }

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
            'SELECT * FROM shop_transactions WHERE shop_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
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
    let { amount, type, description, created_by } = req.body; // type: 'Adjustment'

    // Safety check: If created_by is missing, fetch the acting user's name from the DB
    if (!created_by && req.user && req.user.id) {
        try {
            const [users] = await db.query('SELECT first_name, last_name FROM employees WHERE id = ?', [req.user.id]);
            if (users.length > 0) {
                created_by = `${users[0].first_name} ${users[0].last_name || ''}`.trim();
            }
        } catch (e) {
            console.error('Failed to fetch user name for balance adjustment:', e);
        }
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [shops] = await connection.query('SELECT id, shop_name, village_name, balance, order_line_id FROM shops WHERE id = ? FOR UPDATE', [id]);
        if (shops.length === 0) throw new Error('Shop not found');
        const shop = shops[0];

        // Self-Healing: If order_line_id is missing, try to find it by village name
        let shopOrderLineId = shop.order_line_id;
        if (!shopOrderLineId) {
            const [ols] = await connection.query('SELECT id FROM order_lines WHERE TRIM(name) = TRIM(?) LIMIT 1', [shop.village_name]);
            if (ols.length > 0) {
                shopOrderLineId = ols[0].id;
                await connection.query('UPDATE shops SET order_line_id = ? WHERE id = ?', [shopOrderLineId, id]);
                console.log(`Self-healed shop ${id}: Linked to order_line ${shopOrderLineId}`);
            }
        }
        if (!shopOrderLineId) throw new Error("Shop is not linked to any Order Line. Please edit the shop and select a Village first.");

        const adjAmount = parseFloat(amount);
        const newBalance = parseFloat(shop.balance) + adjAmount; // amount can be negative

        await connection.query('UPDATE shops SET balance = ? WHERE id = ?', [newBalance, id]);

        const mysqlDate = new Date();
        await connection.query(
            'INSERT INTO shop_transactions (shop_id, type, amount, description, balance_after, created_by, transaction_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [id, 'Adjustment', adjAmount, description || 'Manual Adjustment', newBalance, created_by || 'Admin', mysqlDate]
        );

        // Update daily_collections for this adjustment
        const [dateRows] = await connection.query("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d') as today");
        const todayIST = dateRows[0].today;

        // "Zero-Drift" Sync: Subtract any bills with a FUTURE delivery date so they don't affect Today's dashboard balance
        const [futureRows] = await connection.query(
            "SELECT COALESCE(SUM(total_amount), 0) as future_amount FROM bills WHERE shop_id = ? AND delivery_date > ?",
            [id, todayIST + ' 23:59:59']
        );
        const futureAmount = parseFloat(futureRows[0].future_amount);
        const dashboardBalance = newBalance - futureAmount;

        await connection.query(`
            INSERT INTO daily_collections
                (shop_id, shop_name, village_name, order_line_id, collection_date,
                 old_balance, total_balance)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                total_balance = VALUES(total_balance)
        `, [id, shop.shop_name, shop.village_name, shopOrderLineId, todayIST, parseFloat(shop.balance), dashboardBalance]);

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
