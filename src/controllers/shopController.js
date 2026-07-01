const db = require('../config/db');
const { validationResult } = require('express-validator');
const webhookService = require('../services/webhookService');
const financialService = require('../services/financialService');
const cacheService = require('../services/cacheService');
const notificationService = require('../services/notificationService');

// Legacy local rebuildRipple removed in favor of financialService.rebuildRipple


// GET all shops for a specific order_line (village)
const getShopsByOrderLine = async (req, res) => {
    const { order_line_id } = req.params;
    try {
        const [shops] = await db.query(
            `SELECT s.id, s.order_line_id, s.shop_name, s.village_name, s.owner_name, s.shop_owner, s.phone, s.phone2, 
                    s.parent_shop_id, s.without_label_enabled, COALESCE(sb.balance, 0) as balance, s.created_at,
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
    const limit = parseInt(req.query.limit) || 1000;
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * limit;
    try {
        const [shops] = await db.query(
            `SELECT s.id, s.order_line_id, s.shop_name, s.village_name, s.owner_name, s.shop_owner, s.phone, s.phone2, 
                    s.parent_shop_id, s.without_label_enabled, COALESCE(sb.balance, 0) as balance, s.created_at,
                    ol.name AS ol_village_name, ol.area_name, ol.node_id
             FROM shops s
             LEFT JOIN shop_balances sb ON s.id = sb.shop_id
             JOIN order_lines ol ON s.order_line_id = ol.id
             ORDER BY ol.name ASC, s.shop_name ASC
             LIMIT ? OFFSET ?`,
             [limit, offset]
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

    let { order_line_id, shop_name, village_name, owner_name, shop_owner, phone, phone2, balance, created_by, parent_shop_id, without_label_enabled } = req.body;
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
            `INSERT INTO shops (order_line_id, shop_name, village_name, owner_name, shop_owner, phone, phone2, parent_shop_id, without_label_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [order_line_id, shop_name, village_name || '', owner_name || '', shop_owner || '', phone || '', phone2 || '', parent_shop_id || null, without_label_enabled ? 1 : 0]
        );
        const shopId = result.insertId;

        // 2. Insert into shop_balances (opening_balance is set to 0 because it's represented as a transaction)
        await connection.query(
            'INSERT INTO shop_balances (shop_id, balance, opening_balance) VALUES (?, ?, 0)',
            [shopId, startBalance]
        );

        // 3. Insert transaction into shop_transactions if startBalance > 0
        if (startBalance > 0) {
            const istNow = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
            const mysqlDate = istNow.toISOString().slice(0, 19).replace('T', ' '); // IST timestamp
            
            await connection.query(
                `INSERT INTO shop_transactions 
                    (shop_id, type, amount, description, balance_after, approval_status, affects_balance, created_by, transaction_date, transaction_category, payment_mode) 
                 VALUES (?, 'Adjustment', ?, 'Shop Registered (Opening Balance)', ?, 'APPROVED', TRUE, ?, ?, 'MANUAL_ADJUST', 'CASH')`,
                [shopId, startBalance, startBalance, created_by || 'System', mysqlDate]
            );

            // Fetch the formatted date as YYYY-MM-DD
            const [dateRows] = await connection.query("SELECT DATE_FORMAT(?, '%Y-%m-%d') as tx_date", [mysqlDate]);
            const txDate = dateRows[0].tx_date;

            // Update daily_collections for the shop on its registration day
            await connection.query(`
                INSERT INTO daily_collections
                    (shop_id, shop_name, village_name, order_line_id, collection_date,
                     manual_adjustments, old_balance, total_balance)
                VALUES (?, ?, ?, ?, ?, ?, 0, ?)
                ON DUPLICATE KEY UPDATE
                    manual_adjustments = manual_adjustments + VALUES(manual_adjustments),
                    total_balance = old_balance + todays_bill_amount - (cash_collected + upi_collected + cheque_collected) + manual_adjustments
            `, [shopId, shop_name, village_name || '', order_line_id, txDate, startBalance, startBalance]);

            // Rebuild the balance ripple sequentially
            await financialService.rebuildRipple(connection, shopId, txDate);
        } else if (parent_shop_id) {
            // Trigger ripple for new child shop to inherit the parent group balance
            const istNow = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
            const mysqlDate = istNow.toISOString().slice(0, 19).replace('T', ' '); // IST timestamp
            const [dateRows] = await connection.query("SELECT DATE_FORMAT(?, '%Y-%m-%d') as tx_date", [mysqlDate]);
            const txDate = dateRows[0].tx_date;
            await financialService.rebuildRipple(connection, shopId, txDate);
        }

        await connection.commit();
        cacheService.flush();

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
    const { shop_name, village_name, owner_name, shop_owner, phone, phone2, balance, parent_shop_id, without_label_enabled } = req.body;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Fetch current shop and balance
        const [oldShops] = await connection.query(`
            SELECT s.shop_name, s.village_name, s.owner_name as specific_area, COALESCE(sb.balance, 0) as balance, s.order_line_id, s.parent_shop_id, s.phone, s.phone2, s.shop_owner, s.without_label_enabled
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

        const newParentShopId = parent_shop_id !== undefined ? (parent_shop_id === '' ? null : parent_shop_id) : oldShop.parent_shop_id;
        const parentShopIdChanged = oldShop.parent_shop_id !== newParentShopId;

        // 1. Update shops table (excluding balance)
        await connection.query(
            `UPDATE shops SET shop_name = ?, village_name = ?, owner_name = ?, shop_owner = ?, phone = ?, phone2 = ?, order_line_id = ?, parent_shop_id = ?, without_label_enabled = ? WHERE id = ?`,
            [shop_name || oldShop.shop_name, village_name || oldShop.village_name, owner_name || oldShop.specific_area, shop_owner || '', phone || '', phone2 || '', req.body.order_line_id || oldShop.order_line_id, newParentShopId, without_label_enabled !== undefined ? (without_label_enabled ? 1 : 0) : oldShop.without_label_enabled, id]
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

        // Fetch IST Date
        const [dateRows] = await connection.query("SELECT DATE_FORMAT(CONVERT_TZ(NOW(), '+00:00', '+05:30'), '%Y-%m-%d') as today");
        const todayIST = dateRows[0].today;

        // 3. Check if balance or metadata changed
        const metadataChanged = 
            (shop_name !== undefined && shop_name !== null && shop_name.trim() !== (oldShop.shop_name || '').trim()) ||
            (village_name !== undefined && village_name !== null && village_name.trim() !== (oldShop.village_name || '').trim()) ||
            (owner_name !== undefined && owner_name !== null && owner_name.trim() !== (oldShop.specific_area || '').trim()) ||
            (shop_owner !== undefined && shop_owner !== null && shop_owner.trim() !== (oldShop.shop_owner || '').trim()) ||
            (phone !== undefined && phone !== null && phone.trim() !== (oldShop.phone || '').trim()) ||
            (phone2 !== undefined && phone2 !== null && phone2.trim() !== (oldShop.phone2 || '').trim()) ||
            parentShopIdChanged;

        if (oldBalance !== newBalance || metadataChanged) {
            let actingUserName = 'Admin';
            if (req.user && req.user.id) {
                const [users] = await connection.query('SELECT first_name, last_name FROM employees WHERE id = ?', [req.user.id]);
                if (users.length > 0) {
                    actingUserName = `${users[0].first_name} ${users[0].last_name || ''}`.trim();
                }
            }

            const amountDiff = newBalance - oldBalance;
            const descriptionToSend = oldBalance !== newBalance 
                ? 'Manual Balance Update (Edit Shop)' 
                : 'Shop Details Updated (Edit Shop)';

            const mysqlDate = new Date();
            await connection.query(
                'INSERT INTO shop_transactions (shop_id, type, amount, description, balance_after, created_by, transaction_date, transaction_category) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [id, 'Adjustment', amountDiff, descriptionToSend, newBalance, actingUserName, mysqlDate, 'MANUAL_ADJUST']
            );

            if (oldBalance !== newBalance) {
                // Update daily_collections for this manual edit
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
                `, [id, shop_name || oldShop.shop_name, village_name || oldShop.village_name, oldShop.order_line_id, todayIST, oldBalance, dashboardBalance]);
            }

            if (oldBalance !== newBalance || parentShopIdChanged) {
                // Recalculate daily collections balance ripple
                await financialService.rebuildRipple(connection, id, todayIST);

                // If parent shop ID changed, rebuild the old parent shop's ripple as well
                if (parentShopIdChanged && oldShop.parent_shop_id) {
                    await financialService.rebuildRipple(connection, oldShop.parent_shop_id, todayIST);
                }
            }

            webhookService.sendTransactionToWebhook({
                shop_id: id,
                shop_name: shop_name || oldShop.shop_name,
                village_name: village_name || oldShop.village_name,
                specific_area: owner_name || oldShop.specific_area,
                shop_owner: shop_owner !== undefined ? shop_owner : oldShop.shop_owner,
                phone: phone !== undefined ? phone : oldShop.phone,
                phone2: phone2 !== undefined ? phone2 : oldShop.phone2,
                parent_shop_id: newParentShopId,
                type: 'Adjustment',
                amount: amountDiff,
                description: descriptionToSend,
                balance_before: oldBalance,
                balance_after: newBalance,
                created_by: actingUserName
            });
        }

        await connection.commit();
        cacheService.flush();
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

        // Fetch all child shops linked to this parent shop so we can repair their balances after deletion
        const [children] = await connection.query('SELECT id FROM shops WHERE parent_shop_id = ?', [id]);

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
        await connection.query('DELETE FROM daily_collections WHERE shop_id = ?', [id]);
        await connection.query('DELETE FROM product_returns WHERE shop_id = ?', [id]);

        // 4. Finally delete the shop
        await connection.query('DELETE FROM shops WHERE id = ?', [id]);

        // 5. Rebuild ripples for any orphan child shops so their standalone balances are recalculated
        if (children.length > 0) {
            const [dateRows] = await connection.query("SELECT DATE_FORMAT(CONVERT_TZ(NOW(), '+00:00', '+05:30'), '%Y-%m-%d') as today");
            const todayIST = dateRows[0].today;
            for (const child of children) {
                await financialService.rebuildRipple(connection, child.id, todayIST);
            }
        }

        await connection.commit();
        cacheService.flush();
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
    let { amount, payment_method, description, created_by, collection_date } = req.body;

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
        const [dateRows] = await connection.query("SELECT DATE_FORMAT(CONVERT_TZ(NOW(), '+00:00', '+05:30'), '%Y-%m-%d') as today");
        const todayIST = dateRows[0].today;
        // Use caller-provided date for retroactive entries; fall back to today
        const targetDate = collection_date || todayIST;
        // Build transaction_date: past date + actual current IST time (so ledger shows real action time)
        const istNow = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
        const currentISTTime = istNow.toISOString().slice(11, 19); // HH:MM:SS in IST
        const mysqlDate = collection_date
            ? `${collection_date} ${currentISTTime}`   // past date + current IST time
            : istNow.toISOString().slice(0, 19).replace('T', ' '); // full current IST datetime
        const [collRows] = await connection.query(
            "SELECT total_balance, future_bills FROM daily_collections WHERE shop_id = ? AND collection_date = ?",
            [id, targetDate]
        );
        
        // ── PAYMENT SHIELD: total_balance now already excludes future_bills ──
        // activeDebt = total_balance (which is: old_balance + todays_bill - collected + manual_adj)
        // If no row exists yet today, use current shop balance as active debt.
        const activeDebt = collRows.length > 0 ? parseFloat(collRows[0].total_balance) : currentBalance;

        if (payAmount > activeDebt + 0.01) {
            await connection.rollback();
            return res.status(400).json({ 
                message: `Invalid to collect future bill amount. Max collectible: ₹${activeDebt.toFixed(2)}` 
            });
        }

        // mysqlDate and targetDate already computed above
        const payMethod = (payment_method || 'Cash').toUpperCase();
        
        // Comprehensive check for ANY digital or cheque mode
        const isDiscount = payMethod === 'DISCOUNT';
        const isDigital = !isDiscount && (
                         payMethod.includes('UPI') || payMethod.includes('GPAY') || 
                         payMethod.includes('PHONEPE') || payMethod.includes('PAYTM') || 
                         payMethod.includes('CHEQUE') || payMethod.includes('CHECK'));
        
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

        // 4. Update daily_collections ONLY if approved (Cash or Discount)
        if (affectsBalance) {
            if (isDiscount) {
                // DISCOUNT: reduce balance via manual_adjustments, NOT collection columns
                await connection.query(`
                    INSERT INTO daily_collections
                        (shop_id, shop_name, village_name, order_line_id, collection_date,
                         manual_adjustments, old_balance, total_balance,
                         future_bills)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
                    ON DUPLICATE KEY UPDATE
                        manual_adjustments = manual_adjustments + VALUES(manual_adjustments),
                        total_balance = old_balance + todays_bill_amount - (cash_collected + upi_collected + cheque_collected) + manual_adjustments
                `, [id, shop.shop_name, shop.village_name, shopOrderLineId,
                    targetDate, -payAmount, parseFloat(shop.balance), newBalance]);
            } else {
                // CASH / DUAL: update collection columns
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
                    targetDate, c, u, q, parseFloat(shop.balance), dashboardBalance]);
            }

            // SOURCE-OF-TRUTH RIPPLE: recalculate all future rows from actual total_balance
            await financialService.rebuildRipple(connection, id, targetDate);
        }

        await connection.commit();
        cacheService.flush();

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

        // Notify Admins if payment requires approval
        if (isDigital) {
            const formattedAmount = payAmount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
            notificationService.sendPushToAdmins(
                "New Pending Collection 💰",
                `${created_by || 'Staff'} submitted a digital/cheque payment of ${formattedAmount} for ${shop.shop_name} needing approval.`
            ).catch(err => console.error("Admin push notify error:", err));
        }
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
        // Find all shop IDs in the linked group
        const [shopRows] = await db.query('SELECT parent_shop_id FROM shops WHERE id = ?', [id]);
        let linkedShopIds = [parseInt(id)];
        if (shopRows.length > 0) {
            const parentId = shopRows[0].parent_shop_id || id;
            const [groupRows] = await db.query('SELECT id FROM shops WHERE id = ? OR parent_shop_id = ?', [parentId, parentId]);
            if (groupRows.length > 0) {
                linkedShopIds = groupRows.map(r => r.id);
            }
        }

        const [transactions] = await db.query(
            `SELECT t.id, t.shop_id, s.shop_name, s.village_name, t.type, t.amount, t.payment_mode, t.transaction_category, t.description, 
                    t.balance_after, t.approval_status, t.affects_balance, t.created_by, t.transaction_date, t.approved_by, t.approved_at, t.rejected_reason, t.created_at 
             FROM shop_transactions t
             JOIN shops s ON t.shop_id = s.id
             WHERE t.shop_id IN (?) 
             ORDER BY t.transaction_date DESC, t.id DESC 
             LIMIT ? OFFSET ?`,
            [linkedShopIds, limit, skip]
        );
        res.json(transactions);
    } catch (err) {
        console.error('getShopLedger error:', err);
        res.status(500).json({ error: 'Failed to fetch ledger' });
    }
};

// POST Adjust Balance (Admin only)
const adjustBalance = async (req, res) => {
    const { id } = req.params;
    let { amount, type, description, created_by, payment_method, collection_date } = req.body; // type: 'Adjustment'

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
        const isDiscount = (payment_method || '').toUpperCase() === 'DISCOUNT';
        const approvalStatus = (isCash || isDiscount) ? 'APPROVED' : 'PENDING';
        const affectsBalance = isCash || isDiscount;

        const [dateRows] = await connection.query("SELECT DATE_FORMAT(CONVERT_TZ(NOW(), '+00:00', '+05:30'), '%Y-%m-%d') as today");
        const todayIST = dateRows[0].today;
        // Use caller-provided date for retroactive entries; fall back to today
        const targetDate = collection_date || todayIST;
        // Build transaction_date: past date + actual current IST time (so ledger shows real action time)
        const istNow = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
        const currentISTTime = istNow.toISOString().slice(11, 19); // HH:MM:SS in IST
        const mysqlDate = collection_date
            ? `${collection_date} ${currentISTTime}`   // past date + current IST time
            : istNow.toISOString().slice(0, 19).replace('T', ' '); // full current IST datetime

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

        // mysqlDate already computed above from targetDate
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
            `, [id, shop.shop_name, shop.village_name, shopOrderLineId, targetDate, adjAmount, parseFloat(shop.balance), newBalance]);

            // SOURCE-OF-TRUTH RIPPLE: recalculate all future rows from actual total_balance
            await financialService.rebuildRipple(connection, id, targetDate);
        }

        await connection.commit();
        cacheService.flush();

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
            message: (isCash || isDiscount) ? 'Balance adjusted successfully' : 'Adjustment submitted for Admin approval', 
            new_balance: newBalance,
            status: approvalStatus
        });

        // Notify Admins if adjustment requires approval
        if (!affectsBalance) {
            const formattedAmount = adjAmount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
            notificationService.sendPushToAdmins(
                "New Pending Adjustment ⚙️",
                `${created_by || 'Staff'} submitted an adjustment of ${formattedAmount} for ${shop.shop_name} needing approval.`
            ).catch(err => console.error("Admin push notify error:", err));
        }
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
        const [txs] = await connection.query(
            `SELECT id, shop_id, type, amount, payment_mode, transaction_category, description, 
                    balance_after, approval_status, affects_balance, created_by, transaction_date 
             FROM shop_transactions WHERE id = ? FOR UPDATE`,
            [tx_id]
        );
        if (txs.length === 0) return res.status(404).json({ error: 'Transaction not found' });
        const tx = txs[0];

        if (tx.approval_status !== 'PENDING') return res.status(400).json({ error: 'Transaction is already processed' });

        // 2. Get Shop
        const [shops] = await connection.query(`
            SELECT s.id, s.order_line_id, s.shop_name, s.village_name, s.owner_name, s.shop_owner, s.phone, s.phone2, s.created_at,
                   COALESCE(sb.balance, 0) as balance 
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

        // 4. Update Transaction status (use explicit IST timestamp)
        const istApproveTime = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
        const istApproveStr = istApproveTime.toISOString().slice(0, 19).replace('T', ' ');
        await connection.query(
            `UPDATE shop_transactions SET 
             approval_status = 'APPROVED', 
             affects_balance = TRUE, 
             balance_after = ?, 
             approved_by = ?, 
             approved_at = ?
             WHERE id = ?`,
            [newBalance, actingUserName, istApproveStr, tx_id]
        );

        // 5. Update daily_collections
        const [dateRows] = await connection.query("SELECT DATE_FORMAT(?, '%Y-%m-%d') as tx_date", [tx.transaction_date]);
        const txDate = dateRows[0].tx_date;

        if (isPayment) {
            const payMethod = (tx.payment_mode || 'Cash').toLowerCase();
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

        // SOURCE-OF-TRUTH RIPPLE: recalculate all future rows from actual total_balance
        await financialService.rebuildRipple(connection, tx.shop_id, txDate);

        await connection.commit();
        cacheService.flush();

        // Push to Webhook
        webhookService.sendTransactionToWebhook({
            shop_id: tx.shop_id,
            shop_name: shop.shop_name,
            village_name: shop.village_name,
            specific_area: shop.owner_name,
            type: tx.type,
            amount: isPayment ? -amount : amount,
            payment_method: tx.payment_mode,
            description: tx.description + ' (APPROVED)',
            balance_before: currentBalance,
            balance_after: newBalance,
            created_by: actingUserName
        });

        res.json({ message: 'Transaction approved', new_balance: newBalance });

        // Push notification to creator
        if (tx.created_by) {
            const formattedAmount = parseFloat(tx.amount).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
            const typeStr = tx.transaction_category === 'PAYMENT' ? 'Payment collection' : 'Transaction';
            notificationService.sendPushToUserByName(
                tx.created_by,
                "Transaction Approved! ✅",
                `Your ${typeStr} of ${formattedAmount} for ${shop.shop_name} has been approved.`
            ).catch(err => console.error("Push notify error:", err));
        }
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
        // Query transaction details before rejecting to send push notification
        const [txs] = await db.query(
            `SELECT t.created_by, t.amount, t.transaction_category, s.shop_name 
             FROM shop_transactions t
             JOIN shops s ON t.shop_id = s.id
             WHERE t.id = ? AND t.approval_status = 'PENDING'`,
            [tx_id]
        );

        await db.query(
            "UPDATE shop_transactions SET approval_status = 'REJECTED', rejected_reason = ? WHERE id = ? AND approval_status = 'PENDING'",
            [reason || 'Rejected by Admin', tx_id]
        );
        cacheService.flush();
        res.json({ message: 'Transaction rejected' });

        if (txs.length > 0 && txs[0].created_by) {
            const tx = txs[0];
            const formattedAmount = parseFloat(tx.amount).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
            const typeStr = tx.transaction_category === 'PAYMENT' ? 'Payment collection' : 'Transaction';
            notificationService.sendPushToUserByName(
                tx.created_by,
                "Transaction Rejected! ❌",
                `Your ${typeStr} of ${formattedAmount} for ${tx.shop_name} was rejected. Reason: ${reason || 'Rejected by Admin'}`
            ).catch(err => console.error("Push notify error:", err));
        }
    } catch (err) {
        console.error('Error rejecting transaction:', err);
        res.status(500).json({ error: 'Failed to reject transaction' });
    }
};

/**
 * POST /api/shops/:id/repair-ripple?fromDate=YYYY-MM-DD
 * Admin-only: Rebuild all future daily_collections rows from source-of-truth.
 * Use this to fix corrupted Prev Bal values without touching the database directly.
 */
const repairShopRipple = async (req, res) => {
    const { id } = req.params;
    const { fromDate } = req.query;
    if (!fromDate) return res.status(400).json({ error: 'fromDate query param required (YYYY-MM-DD)' });

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        await financialService.rebuildRipple(connection, id, fromDate);
        await connection.commit();
        cacheService.flush();
        res.json({ message: `Ripple rebuilt for shop ${id} from ${fromDate}` });
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        connection.release();
    }
};

const repairAllShopsRipple = async (req, res) => {
    const connection = await db.getConnection();
    try {
        const [shops] = await connection.query('SELECT id, shop_name FROM shops');
        console.log(`[REPAIR] Starting global repair for ${shops.length} shops`);

        for (const shop of shops) {
            await connection.beginTransaction();
            try {
                // Find earliest transaction
                const [firstTx] = await connection.query(
                    'SELECT MIN(transaction_date) as start_date FROM shop_transactions WHERE shop_id = ?',
                    [shop.id]
                );
                const startDate = firstTx[0].start_date || '2000-01-01';
                
                await financialService.rebuildRipple(connection, shop.id, startDate);
                await connection.commit();
            } catch (err) {
                await connection.rollback();
                console.error(`Failed to repair shop ${shop.id}:`, err.message);
            }
        }
        cacheService.flush();
        res.json({ message: `Repair complete for ${shops.length} shops` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        connection.release();
    }
};

// POST Record Product Return
const recordProductReturn = async (req, res) => {
    const { id } = req.params;
    let { product_name, amount, created_by, collection_date } = req.body;

    if (!product_name || !amount) {
        return res.status(400).json({ error: 'Product name and return amount are required' });
    }

    // Safety check: If created_by is missing, fetch the acting user's name from the DB
    if (!created_by && req.user && req.user.id) {
        try {
            const [users] = await db.query('SELECT first_name, last_name FROM employees WHERE id = ?', [req.user.id]);
            if (users.length > 0) {
                created_by = `${users[0].first_name} ${users[0].last_name || ''}`.trim();
            }
        } catch (e) {
            console.error('Failed to fetch user name for return collection:', e);
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

        let shopOrderLineId = shop.order_line_id;
        if (!shopOrderLineId) {
            const [ols] = await connection.query('SELECT id FROM order_lines WHERE TRIM(name) = TRIM(?) LIMIT 1', [shop.village_name]);
            if (ols.length > 0) {
                shopOrderLineId = ols[0].id;
                await connection.query('UPDATE shops SET order_line_id = ? WHERE id = ?', [shopOrderLineId, id]);
            }
        }
        if (!shopOrderLineId) throw new Error("Shop is not linked to any Order Line.");

        const returnAmount = parseFloat(amount);
        const currentBalance = parseFloat(shop.balance) || 0;

        const [dateRows] = await connection.query("SELECT DATE_FORMAT(CONVERT_TZ(NOW(), '+00:00', '+05:30'), '%Y-%m-%d') as today");
        const todayIST = dateRows[0].today;
        const targetDate = collection_date || todayIST;

        const istNow = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
        const currentISTTime = istNow.toISOString().slice(11, 19); // HH:MM:SS in IST
        const mysqlDate = collection_date
            ? `${collection_date} ${currentISTTime}`
            : istNow.toISOString().slice(0, 19).replace('T', ' ');

        const newBalance = currentBalance - returnAmount;

        // 2. Update shop_balances
        await connection.query(
            'UPDATE shop_balances SET balance = ? WHERE shop_id = ?',
            [newBalance, id]
        );

        // 3. Insert detailed Product Return item
        await connection.query(`
            INSERT INTO product_returns (shop_id, product_name, amount, created_by, return_date)
            VALUES (?, ?, ?, ?, ?)
        `, [id, product_name, returnAmount, created_by || 'Staff', targetDate]);

        // 4. Insert Transaction in shop_transactions
        await connection.query(`
            INSERT INTO shop_transactions 
                (shop_id, type, amount, payment_mode, transaction_category, description, 
                 balance_after, approval_status, affects_balance, created_by, transaction_date) 
             VALUES (?, 'Return', ?, 'Return', 'RETURN', ?, ?, 'APPROVED', 1, ?, ?)
        `, [id, returnAmount, `Product Return: ${product_name} (₹${returnAmount})`, 
             newBalance, created_by || 'Staff', mysqlDate]);

        // 5. Update daily_collections return_amount
        await connection.query(`
            INSERT INTO daily_collections
                (shop_id, shop_name, village_name, order_line_id, collection_date,
                 return_amount, old_balance, total_balance,
                 future_bills, manual_adjustments)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
            ON DUPLICATE KEY UPDATE
                return_amount = return_amount + VALUES(return_amount),
                total_balance = old_balance + todays_bill_amount - (cash_collected + upi_collected + cheque_collected) + manual_adjustments - return_amount
        `, [id, shop.shop_name, shop.village_name, shopOrderLineId,
            targetDate, returnAmount, currentBalance, newBalance]);

        // 6. SOURCE-OF-TRUTH RIPPLE
        await financialService.rebuildRipple(connection, id, targetDate);

        await connection.commit();
        cacheService.flush();

        // Push to Webhook
        webhookService.sendTransactionToWebhook({
            shop_id: id,
            shop_name: shop.shop_name,
            village_name: shop.village_name,
            specific_area: shop.specific_area,
            type: 'Return',
            amount: -returnAmount,
            payment_method: 'Return',
            description: `Product Return: ${product_name}`,
            balance_before: currentBalance,
            balance_after: newBalance,
            created_by: created_by || 'Staff'
        });

        res.json({ 
            message: 'Product return recorded successfully', 
            new_balance: newBalance
        });
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
    syncAllShopsToLedger,
    approveTransaction,
    rejectTransaction,
    repairShopRipple,
    repairAllShopsRipple,
    recordProductReturn
};
