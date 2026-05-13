const db = require('../config/db');
const { validationResult } = require('express-validator');
const webhookService = require('../services/webhookService');



// GET all shops for a specific order_line (village)
const getShopsByOrderLine = async (req, res) => {
    const { order_line_id } = req.params;
    try {
        const [shops] = await db.query(
            `SELECT s.id, s.order_line_id, s.shop_name, s.village_name, s.owner_name, s.shop_owner, s.phone, s.phone2, 
                    COALESCE(sb.balance, 0) as balance, s.created_at,
                    ol.area_name,
                    CAST(EXISTS(
                        SELECT 1 FROM bills b 
                        WHERE b.shop_id = s.id
                        AND DATE(CONVERT_TZ(b.created_at, '+00:00', '+05:30')) = DATE(CONVERT_TZ(NOW(), '+00:00', '+05:30'))
                    ) AS UNSIGNED) as has_order_today
             FROM shops s 
             LEFT JOIN shop_balances sb ON s.id = sb.shop_id
             LEFT JOIN order_lines ol ON s.order_line_id = ol.id
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
            `SELECT s.id, s.order_line_id, s.shop_name, s.village_name, s.owner_name, s.shop_owner, s.phone, s.phone2, 
                    COALESCE(sb.balance, 0) as balance, s.created_at,
                    ol.name AS ol_village_name, ol.area_name, ol.node_id
             FROM shops s
             LEFT JOIN shop_balances sb ON s.id = sb.shop_id
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

    let { order_line_id, shop_name, village_name, owner_name, shop_owner, phone, phone2, balance, created_by } = req.body;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Safety check: If created_by is missing, fetch the acting user's name from the DB
        if (!created_by && req.user && req.user.id) {
            const [users] = await connection.query('SELECT first_name, last_name FROM employees WHERE id = ?', [req.user.id]);
            if (users.length > 0) {
                created_by = `${users[0].first_name} ${users[0].last_name || ''}`.trim();
            }
        }

        const startBalance = parseFloat(balance) || 0;
        
        // 1. Insert into shops
        const [result] = await connection.query(
            `INSERT INTO shops (order_line_id, shop_name, village_name, owner_name, shop_owner, phone, phone2) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [order_line_id, shop_name, village_name || '', owner_name || '', shop_owner || '', phone || '', phone2 || '']
        );
        const shopId = result.insertId;

        // 2. Insert into shop_balances
        await connection.query(
            'INSERT INTO shop_balances (shop_id, balance, opening_balance) VALUES (?, ?, ?)',
            [shopId, startBalance, startBalance]
        );

        await connection.commit();

        // Push "Opening Balance" to Webhook
        webhookService.sendTransactionToWebhook({
            shop_id: shopId,
            shop_name: shop_name,
            village_name: village_name || '',
            specific_area: owner_name || '',
            type: 'Registration',
            amount: startBalance,
            description: 'Shop Registered (Opening Balance)',
            balance_before: 0,
            balance_after: startBalance,
            created_by: created_by || 'System'
        });

        res.status(201).json({ id: shopId, message: 'Shop created successfully' });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('createShop error:', err);
        res.status(500).json({ error: 'Failed to create shop' });
    } finally {
        if (connection) connection.release();
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

        // Fetch current shop and balance
        const [oldShops] = await connection.query(`
            SELECT s.shop_name, s.village_name, s.owner_name as specific_area, COALESCE(sb.balance, 0) as balance, s.order_line_id 
            FROM shops s
            LEFT JOIN shop_balances sb ON s.id = sb.shop_id
            WHERE s.id = ? FOR UPDATE
        `, [id]);
        
        if (oldShops.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Shop not found' });
        }
        
        const oldShop = oldShops[0];
        const oldBalance = parseFloat(oldShop.balance);
        const newBalance = balance !== undefined ? parseFloat(balance) : oldBalance;

        // 1. Update shops table (excluding balance)
        await connection.query(
            `UPDATE shops SET shop_name = ?, village_name = ?, owner_name = ?, shop_owner = ?, phone = ?, phone2 = ?, order_line_id = ? WHERE id = ?`,
            [shop_name || oldShop.shop_name, village_name || oldShop.village_name, owner_name || oldShop.specific_area, shop_owner || '', phone || '', phone2 || '', req.body.order_line_id || oldShop.order_line_id, id]
        );

        // 2. Update shop_balances table
        await connection.query(
            'INSERT INTO shop_balances (shop_id, balance) VALUES (?, ?) ON DUPLICATE KEY UPDATE balance = VALUES(balance)',
            [id, newBalance]
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
                specific_area: owner_name || '',
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
        const [shops] = await connection.query(`
            SELECT s.shop_name, s.village_name, s.owner_name as specific_area, COALESCE(sb.balance, 0) as balance 
            FROM shops s
            LEFT JOIN shop_balances sb ON s.id = sb.shop_id
            WHERE s.id = ? FOR UPDATE
        `, [id]);

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
            specific_area: shop.specific_area,
            type: 'Deletion',
            amount: 0,
            description: 'Shop Deleted / Account Closed',
            balance_before: parseFloat(shop.balance),
            balance_after: 0,
            created_by: actingUserName
        });

        // 3. Delete related records
        await connection.query('DELETE FROM shop_transactions WHERE shop_id = ?', [id]);
        await connection.query('DELETE FROM bills WHERE shop_id = ?', [id]);
        await connection.query('DELETE FROM shop_balances WHERE shop_id = ?', [id]);

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
        const [shops] = await db.query(`
            SELECT s.id, s.shop_name, s.village_name, s.owner_name as specific_area, COALESCE(sb.balance, 0) as balance 
            FROM shops s
            LEFT JOIN shop_balances sb ON s.id = sb.shop_id
        `);
        
        // Split into batches of 100 to prevent timeouts
        const BATCH_SIZE = 100;
        for (let i = 0; i < shops.length; i += BATCH_SIZE) {
            const batch = shops.slice(i, i + BATCH_SIZE);
            const bulkData = batch.map(shop => ({
                shop_id: shop.id,
                shop_name: shop.shop_name,
                village_name: shop.village_name,
                specific_area: shop.specific_area,
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

        // 1. Get current shop and balance
        const [shops] = await connection.query(`
            SELECT s.id, s.shop_name, s.village_name, s.order_line_id, COALESCE(sb.balance, 0) as balance, s.owner_name as specific_area
            FROM shops s
            LEFT JOIN shop_balances sb ON s.id = sb.shop_id
            WHERE s.id = ? FOR UPDATE
        `, [id]);
        
        if (shops.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Shop not found' });
        }
        const shop = shops[0];

        // Self-Healing: If order_line_id is missing...
        let shopOrderLineId = shop.order_line_id;
        if (!shopOrderLineId) {
            const [ols] = await connection.query('SELECT id FROM order_lines WHERE TRIM(name) = TRIM(?) LIMIT 1', [shop.village_name]);
            if (ols.length > 0) {
                shopOrderLineId = ols[0].id;
                await connection.query('UPDATE shops SET order_line_id = ? WHERE id = ?', [shopOrderLineId, id]);
            }
        }
        if (!shopOrderLineId) throw new Error("Shop is not linked to any Order Line.");

        const payAmount = parseFloat(amount);
        const currentBalance = parseFloat(shop.balance) || 0;

        // ── PAYMENT SHIELD: Calculate Active Debt (Total - Future) ──
        const [dateRows] = await connection.query("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d') as today");
        const todayIST = dateRows[0].today;
        const [collRows] = await connection.query(
            "SELECT total_balance, future_bills FROM daily_collections WHERE shop_id = ? AND collection_date = ?",
            [id, todayIST]
        );
        
        // ── PAYMENT SHIELD: total_balance now already excludes future_bills ──
        // activeDebt = total_balance (which is: old_balance + todays_bill - collected + manual_adj)
        // If no row exists yet today, use current shop balance as active debt.
        const activeDebt = collRows.length > 0 ? parseFloat(collRows[0].total_balance) : currentBalance;

        if (payAmount > activeDebt + 0.01) {
            return res.status(400).json({ 
                message: `Invalid to collect future bill amount. Max collectible: ₹${activeDebt.toFixed(2)}` 
            });
        }

        const mysqlDate = new Date();
        const payMethod = (payment_method || 'Cash').toUpperCase();
        
        // Comprehensive check for ANY digital or cheque mode
        const isDigital = payMethod.includes('UPI') || payMethod.includes('GPAY') || 
                         payMethod.includes('PHONEPE') || payMethod.includes('PAYTM') || 
                         payMethod.includes('CHEQUE') || payMethod.includes('CHECK');
        
        const approvalStatus = isDigital ? 'PENDING' : 'APPROVED';
        const affectsBalance = !isDigital;
        
        const newBalance = affectsBalance ? currentBalance - payAmount : currentBalance;
        const delta = affectsBalance ? -payAmount : 0;

        // 2. Update shop_balances ONLY if approved (Cash)
        if (affectsBalance) {
            await connection.query(
                'UPDATE shop_balances SET balance = ? WHERE shop_id = ?',
                [newBalance, id]
            );
        }

        // 3. Insert Transaction with explicit status
        await connection.query(
            `INSERT INTO shop_transactions 
                (shop_id, type, amount, payment_mode, transaction_category, description, 
                 balance_after, approval_status, affects_balance, created_by, transaction_date) 
             VALUES (?, 'Payment', ?, ?, 'PAYMENT', ?, ?, ?, ?, ?, ?)`,
            [id, payAmount, payMethod, description || `Payment Received (${payMethod})`, 
             newBalance, approvalStatus, affectsBalance, created_by || 'Staff', mysqlDate]
        );

        // 4. Update daily_collections ONLY if approved (Cash)
        if (affectsBalance) {
            const { cash_amount, upi_amount, cheque_amount } = req.body;
            const dashboardBalance = newBalance;

            // Use split logic if provided, else fallback to full amount as cash
            const c = cash_amount !== undefined ? parseFloat(cash_amount) : payAmount;
            const u = parseFloat(upi_amount) || 0;
            const q = parseFloat(cheque_amount) || 0;

            await connection.query(`
                INSERT INTO daily_collections
                    (shop_id, shop_name, village_name, order_line_id, collection_date,
                     cash_collected, upi_collected, cheque_collected, old_balance, total_balance,
                     future_bills, manual_adjustments)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
                ON DUPLICATE KEY UPDATE
                    cash_collected = cash_collected + VALUES(cash_collected),
                    upi_collected = upi_collected + VALUES(upi_collected),
                    cheque_collected = cheque_collected + VALUES(cheque_collected),
                    total_balance = old_balance + todays_bill_amount - (cash_collected + upi_collected + cheque_collected) + manual_adjustments
            `, [id, shop.shop_name, shop.village_name, shopOrderLineId,
                todayIST, c, u, q, parseFloat(shop.balance), dashboardBalance]);

            // Ripple forward
            await connection.query(`
                UPDATE daily_collections 
                SET old_balance = old_balance + ?, 
                    total_balance = old_balance + todays_bill_amount - (cash_collected + upi_collected + cheque_collected) + manual_adjustments
                WHERE shop_id = ? AND collection_date > ?
            `, [delta, id, todayIST]);
        }

        await connection.commit();

        // Push to Webhook
        webhookService.sendTransactionToWebhook({
            shop_id: id,
            shop_name: shop.shop_name,
            village_name: shop.village_name,
            specific_area: shop.specific_area,
            type: 'Payment',
            amount: -payAmount,
            payment_method: payMethod,
            description: (description || 'Payment Received') + (isDigital ? ' (PENDING APPROVAL)' : ''),
            balance_before: parseFloat(shop.balance) || 0,
            balance_after: newBalance,
            created_by: created_by || 'Staff'
        });
        res.json({ 
            message: isDigital ? 'Payment submitted for Admin approval' : 'Payment recorded successfully', 
            new_balance: newBalance,
            status: approvalStatus
        });
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
    let { amount, type, description, created_by, payment_method } = req.body; // type: 'Adjustment'

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

        // 1. Get current shop and balance
        const [shops] = await connection.query(`
            SELECT s.id, s.shop_name, s.village_name, s.order_line_id, COALESCE(sb.balance, 0) as balance, s.owner_name as specific_area
            FROM shops s
            LEFT JOIN shop_balances sb ON s.id = sb.shop_id
            WHERE s.id = ? FOR UPDATE
        `, [id]);
        
        if (shops.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Shop not found' });
        }
        const shop = shops[0];

        // Self-Healing...
        let shopOrderLineId = shop.order_line_id;
        if (!shopOrderLineId) {
            const [ols] = await connection.query('SELECT id FROM order_lines WHERE TRIM(name) = TRIM(?) LIMIT 1', [shop.village_name]);
            if (ols.length > 0) {
                shopOrderLineId = ols[0].id;
                await connection.query('UPDATE shops SET order_line_id = ? WHERE id = ?', [shopOrderLineId, id]);
            }
        }
        if (!shopOrderLineId) throw new Error("Shop is not linked to any Order Line.");

        const adjAmount = parseFloat(amount);
        const currentBalance = parseFloat(shop.balance) || 0;

        // ── APPROVAL LOGIC ──
        const isCash = (payment_method || '').toUpperCase() === 'CASH';
        const approvalStatus = isCash ? 'APPROVED' : 'PENDING';
        const affectsBalance = isCash;

        const [dateRows] = await connection.query("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d') as today");
        const todayIST = dateRows[0].today;

        const newBalance = affectsBalance ? currentBalance + adjAmount : currentBalance;

        if (affectsBalance && newBalance < 0) {
            throw new Error(`Resulting balance would be negative (₹${newBalance.toLocaleString('en-IN')}), adjustment cancelled`);
        }

        // 2. Update shop_balances (ONLY if approved)
        if (affectsBalance) {
            await connection.query(
                'INSERT INTO shop_balances (shop_id, balance) VALUES (?, ?) ON DUPLICATE KEY UPDATE balance = VALUES(balance)',
                [id, newBalance]
            );
        }

        const mysqlDate = new Date();
        await connection.query(
            `INSERT INTO shop_transactions 
             (shop_id, type, amount, payment_method, description, balance_after, created_by, transaction_date, 
              approval_status, affects_balance, transaction_category, payment_mode) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id, 'Adjustment', adjAmount, payment_method || null, description || 'Manual Adjustment', 
                newBalance, created_by || 'Admin', mysqlDate,
                approvalStatus, affectsBalance, 'MANUAL_ADJUST', (payment_method || 'CASH').toUpperCase()
            ]
        );

        // 3. Update daily_collections (ONLY if approved)
        if (affectsBalance) {
            await connection.query(`
                INSERT INTO daily_collections
                    (shop_id, shop_name, village_name, order_line_id, collection_date,
                     manual_adjustments, old_balance, total_balance)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    manual_adjustments = manual_adjustments + VALUES(manual_adjustments),
                    total_balance = old_balance + todays_bill_amount - (cash_collected + upi_collected + cheque_collected) + manual_adjustments
            `, [id, shop.shop_name, shop.village_name, shopOrderLineId, todayIST, adjAmount, parseFloat(shop.balance), newBalance]);

            // 4. SMART PROPAGATION: Ripple the adjustment delta to all FUTURE rows
            await connection.query(`
                UPDATE daily_collections 
                SET old_balance = old_balance + ?, 
                    total_balance = old_balance + todays_bill_amount - (cash_collected + upi_collected + cheque_collected) + manual_adjustments
                WHERE shop_id = ? AND collection_date > ?
            `, [adjAmount, id, todayIST]);
        }

        await connection.commit();

        // Push to Webhook (ONLY if approved)
        if (affectsBalance) {
            webhookService.sendTransactionToWebhook({
                shop_id: id,
                shop_name: shop.shop_name,
                village_name: shop.village_name,
                specific_area: shop.specific_area,
                type: 'Adjustment',
                amount: adjAmount,
                payment_method: payment_method || null,
                description: description || 'Manual Adjustment',
                balance_before: parseFloat(shop.balance) || 0,
                balance_after: newBalance,
                created_by: created_by || 'Admin'
            });
        }
        res.json({ 
            message: isCash ? 'Balance adjusted successfully' : 'Adjustment submitted for Admin approval', 
            new_balance: newBalance,
            status: approvalStatus
        });
    } catch (err) {
        if (connection) await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) connection.release();
    }
};


// ADMIN Approval
const approveTransaction = async (req, res) => {
    const { tx_id } = req.params;
    let actingUserName = 'Admin';

    if (req.user && req.user.id) {
        try {
            const [users] = await db.query('SELECT first_name, last_name FROM employees WHERE id = ?', [req.user.id]);
            if (users.length > 0) actingUserName = `${users[0].first_name} ${users[0].last_name || ''}`.trim();
        } catch (e) {}
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get Transaction
        const [txs] = await connection.query('SELECT * FROM shop_transactions WHERE id = ? FOR UPDATE', [tx_id]);
        if (txs.length === 0) return res.status(404).json({ error: 'Transaction not found' });
        const tx = txs[0];

        if (tx.approval_status !== 'PENDING') return res.status(400).json({ error: 'Transaction is already processed' });

        // 2. Get Shop
        const [shops] = await connection.query(`
            SELECT s.*, COALESCE(sb.balance, 0) as balance 
            FROM shops s 
            LEFT JOIN shop_balances sb ON s.id = sb.shop_id 
            WHERE s.id = ? FOR UPDATE
        `, [tx.shop_id]);
        const shop = shops[0];

        const amount = parseFloat(tx.amount);
        const currentBalance = parseFloat(shop.balance);
        
        // Calculate new balance based on category
        // PAYMENT: balance = balance - amount
        // ADJUST: balance = balance + amount (amount can be negative)
        const isPayment = tx.transaction_category === 'PAYMENT';
        const newBalance = isPayment ? currentBalance - amount : currentBalance + amount;
        const delta = isPayment ? -amount : amount;

        // 3. Update shop_balances
        await connection.query(
            'INSERT INTO shop_balances (shop_id, balance) VALUES (?, ?) ON DUPLICATE KEY UPDATE balance = VALUES(balance)',
            [tx.shop_id, newBalance]
        );

        // 4. Update Transaction status
        await connection.query(
            `UPDATE shop_transactions SET 
             approval_status = 'APPROVED', 
             affects_balance = TRUE, 
             balance_after = ?, 
             approved_by = ?, 
             approved_at = NOW() 
             WHERE id = ?`,
            [newBalance, actingUserName, tx_id]
        );

        // 5. Update daily_collections
        const [dateRows] = await connection.query("SELECT DATE_FORMAT(?, '%Y-%m-%d') as tx_date", [tx.transaction_date]);
        const txDate = dateRows[0].tx_date;

        if (isPayment) {
            const payMethod = (tx.payment_method || 'Cash').toLowerCase();
            const columnToUpdate = (payMethod.includes('upi') || payMethod.includes('gpay') || 
                payMethod.includes('phonepe') || payMethod.includes('paytm')) ? 'upi_collected' : (payMethod.includes('cheque') || payMethod.includes('check') ? 'cheque_collected' : 'cash_collected');

            await connection.query(`
                INSERT INTO daily_collections
                    (shop_id, shop_name, village_name, order_line_id, collection_date,
                     ${columnToUpdate}, old_balance, total_balance, future_bills, manual_adjustments)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
                ON DUPLICATE KEY UPDATE
                    ${columnToUpdate} = ${columnToUpdate} + VALUES(${columnToUpdate}),
                    total_balance = old_balance + todays_bill_amount - (cash_collected + upi_collected + cheque_collected) + manual_adjustments
            `, [tx.shop_id, shop.shop_name, shop.village_name, shop.order_line_id, txDate, amount, currentBalance, newBalance]);
        } else {
            await connection.query(`
                INSERT INTO daily_collections
                    (shop_id, shop_name, village_name, order_line_id, collection_date,
                     manual_adjustments, old_balance, total_balance)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    manual_adjustments = manual_adjustments + VALUES(manual_adjustments),
                    total_balance = old_balance + todays_bill_amount - (cash_collected + upi_collected + cheque_collected) + manual_adjustments
            `, [tx.shop_id, shop.shop_name, shop.village_name, shop.order_line_id, txDate, amount, currentBalance, newBalance]);
        }

        // Ripple forward
        await connection.query(`
            UPDATE daily_collections 
            SET old_balance = old_balance + ?, 
                total_balance = old_balance + todays_bill_amount - (cash_collected + upi_collected + cheque_collected) + manual_adjustments
            WHERE shop_id = ? AND collection_date > ?
        `, [delta, tx.shop_id, txDate]);

        await connection.commit();

        // Push to Webhook
        webhookService.sendTransactionToWebhook({
            shop_id: tx.shop_id,
            shop_name: shop.shop_name,
            village_name: shop.village_name,
            specific_area: shop.owner_name,
            type: tx.type,
            amount: isPayment ? -amount : amount,
            payment_method: tx.payment_method,
            description: tx.description + ' (APPROVED)',
            balance_before: currentBalance,
            balance_after: newBalance,
            created_by: actingUserName
        });

        res.json({ message: 'Transaction approved', new_balance: newBalance });
    } catch (err) {
        if (connection) await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) connection.release();
    }
};

const rejectTransaction = async (req, res) => {
    const { tx_id } = req.params;
    const { reason } = req.body;
    try {
        await db.query(
            "UPDATE shop_transactions SET approval_status = 'REJECTED', rejected_reason = ? WHERE id = ? AND approval_status = 'PENDING'",
            [reason || 'Rejected by Admin', tx_id]
        );
        res.json({ message: 'Transaction rejected' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to reject transaction' });
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
    syncAllShopsToLedger,
    approveTransaction,
    rejectTransaction
};
