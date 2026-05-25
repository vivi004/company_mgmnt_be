const db = require('../config/db');
const webhookService = require('../services/webhookService');
const financialService = require('../services/financialService');
const cacheService = require('../services/cacheService');

// 1. LINK shops
exports.linkShops = async (req, res) => {
    if (req.user?.role !== 'Admin' && req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: Admin access required.' });
    }

    let { shopIds, primaryShopId, note } = req.body;

    if (!Array.isArray(shopIds) || shopIds.length < 2) {
        return res.status(400).json({ error: 'Please provide at least 2 shop IDs to link.' });
    }

    // Filter unique IDs and map to integers
    shopIds = [...new Set(shopIds.map(Number))];

    let actingUserName = 'Admin';
    if (req.user && req.user.id) {
        try {
            const [users] = await db.query('SELECT first_name, last_name FROM employees WHERE id = ?', [req.user.id]);
            if (users.length > 0) {
                actingUserName = `${users[0].first_name} ${users[0].last_name || ''}`.trim();
            }
        } catch (e) {
            console.error('Failed to fetch user name for shop linking:', e);
        }
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Fetch shops to verify they exist and get created_at dates
        const [shops] = await connection.query(
            'SELECT id, shop_name, created_at FROM shops WHERE id IN (?)',
            [shopIds]
        );

        if (shops.length !== shopIds.length) {
            await connection.rollback();
            return res.status(400).json({ error: 'One or more provided shop IDs are invalid.' });
        }

        // 2. Resolve Primary Shop (Master)
        if (primaryShopId) {
            primaryShopId = Number(primaryShopId);
            if (!shopIds.includes(primaryShopId)) {
                await connection.rollback();
                return res.status(400).json({ error: 'Selected primary shop ID must be part of the linked shops list.' });
            }
        } else {
            // Pick shop with oldest created_at timestamp
            const sortedShops = [...shops].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
            primaryShopId = sortedShops[0].id;
        }

        // 3. Clear existing links for these shops to allow reorganizing/merging groups cleanly
        await connection.query(
            'DELETE FROM shop_links WHERE primary_shop_id IN (?) OR linked_shop_id IN (?)',
            [shopIds, shopIds]
        );

        // 4. Create new links for duplicate shops
        const duplicateShopIds = shopIds.filter(id => id !== primaryShopId);
        for (const dupId of duplicateShopIds) {
            await connection.query(
                'INSERT INTO shop_links (primary_shop_id, linked_shop_id, linked_by, note) VALUES (?, ?, ?, ?)',
                [primaryShopId, dupId, actingUserName, note || '']
            );
        }

        await connection.commit();
        cacheService.flush();

        res.status(201).json({
            message: 'Shops successfully linked.',
            primary_shop_id: primaryShopId,
            linked_shop_ids: duplicateShopIds
        });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('linkShops error:', err);
        res.status(500).json({ error: 'Failed to link shops.' });
    } finally {
        if (connection) connection.release();
    }
};

// 2. UNLINK a shop
exports.unlinkShop = async (req, res) => {
    if (req.user?.role !== 'Admin' && req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: Admin access required.' });
    }

    const { shopId } = req.body;

    if (!shopId) {
        return res.status(400).json({ error: 'shopId is required to unlink.' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Check if it is a primary shop
        const [primaries] = await connection.query('SELECT linked_shop_id FROM shop_links WHERE primary_shop_id = ?', [shopId]);
        if (primaries.length > 0) {
            // Delete all links for this master shop
            await connection.query('DELETE FROM shop_links WHERE primary_shop_id = ?', [shopId]);
        } else {
            // Otherwise delete the link where it's a child/duplicate
            await connection.query('DELETE FROM shop_links WHERE linked_shop_id = ?', [shopId]);
        }

        await connection.commit();
        cacheService.flush();

        res.json({ message: 'Shop successfully unlinked.' });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('unlinkShop error:', err);
        res.status(500).json({ error: 'Failed to unlink shop.' });
    } finally {
        if (connection) connection.release();
    }
};

// 3. GET linked group for a shop
exports.getShopLinks = async (req, res) => {
    const { id } = req.params;

    try {
        // 1. Find if this shop is a duplicate/child
        const [childRows] = await db.query('SELECT primary_shop_id FROM shop_links WHERE linked_shop_id = ?', [id]);
        
        let primaryShopId;
        if (childRows.length > 0) {
            primaryShopId = childRows[0].primary_shop_id;
        } else {
            // Check if it's a primary shop
            const [parentRows] = await db.query('SELECT 1 FROM shop_links WHERE primary_shop_id = ? LIMIT 1', [id]);
            if (parentRows.length > 0) {
                primaryShopId = Number(id);
            } else {
                // Not linked to anything
                return res.json({ is_linked: false, shops: [] });
            }
        }

        // 2. Fetch all shops in this linked group (Master + Children)
        const [linkedRows] = await db.query('SELECT linked_shop_id FROM shop_links WHERE primary_shop_id = ?', [primaryShopId]);
        const groupIds = [primaryShopId, ...linkedRows.map(r => r.linked_shop_id)];

        // 3. Get detailed information for all shops in the group
        const [shops] = await db.query(`
            SELECT s.id, s.shop_name, s.village_name, s.owner_name as landmark, s.phone, s.created_at,
                   ol.name AS order_line_name, ol.id as order_line_id,
                   COALESCE(sb.balance, 0) AS balance,
                   IF(s.id = ?, 1, 0) as is_primary
            FROM shops s
            LEFT JOIN shop_balances sb ON s.id = sb.shop_id
            LEFT JOIN order_lines ol ON s.order_line_id = ol.id
            WHERE s.id IN (?)
            ORDER BY is_primary DESC, s.created_at ASC
        `, [primaryShopId, groupIds]);

        res.json({
            is_linked: true,
            primary_shop_id: primaryShopId,
            shops
        });
    } catch (err) {
        console.error('getShopLinks error:', err);
        res.status(500).json({ error: 'Failed to fetch shop links.' });
    }
};

// 4. GET possible duplicates (matching name on different routes)
exports.getDuplicateSuggestions = async (req, res) => {
    if (req.user?.role !== 'Admin' && req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: Admin access required.' });
    }

    try {
        const [rows] = await db.query(`
            SELECT s1.id AS id1, s1.shop_name AS name1, s1.created_at AS created_at1, ol1.name AS route1, COALESCE(sb1.balance, 0) AS balance1,
                   s2.id AS id2, s2.shop_name AS name2, s2.created_at AS created_at2, ol2.name AS route2, COALESCE(sb2.balance, 0) AS balance2
            FROM shops s1
            JOIN order_lines ol1 ON s1.order_line_id = ol1.id
            LEFT JOIN shop_balances sb1 ON s1.id = sb1.shop_id
            JOIN shops s2 ON s1.id < s2.id AND LOWER(TRIM(s1.shop_name)) = LOWER(TRIM(s2.shop_name))
            JOIN order_lines ol2 ON s2.order_line_id = ol2.id
            LEFT JOIN shop_balances sb2 ON s2.id = sb2.shop_id
            LEFT JOIN shop_links sl1 ON (sl1.primary_shop_id = s1.id AND sl1.linked_shop_id = s2.id)
            LEFT JOIN shop_links sl2 ON (sl2.primary_shop_id = s2.id AND sl2.linked_shop_id = s1.id)
            WHERE sl1.id IS NULL AND sl2.id IS NULL
            ORDER BY s1.shop_name ASC
        `);

        res.json(rows);
    } catch (err) {
        console.error('getDuplicateSuggestions error:', err);
        res.status(500).json({ error: 'Failed to load duplicate suggestions.' });
    }
};

// 5. POST atomic collect split payment
exports.collectSplitPayment = async (req, res) => {
    const { payment_method, description, created_by, collection_date, allocations } = req.body;

    if (!Array.isArray(allocations) || allocations.length === 0) {
        return res.status(400).json({ error: 'Please provide at least one allocation.' });
    }

    let actingUserName = created_by;
    if (!actingUserName && req.user && req.user.id) {
        try {
            const [users] = await db.query('SELECT first_name, last_name FROM employees WHERE id = ?', [req.user.id]);
            if (users.length > 0) {
                actingUserName = `${users[0].first_name} ${users[0].last_name || ''}`.trim();
            }
        } catch (e) {
            console.error('Failed to fetch user name for split collection:', e);
        }
    }
    if (!actingUserName) actingUserName = 'Staff';

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [dateRows] = await connection.query("SELECT DATE_FORMAT(CONVERT_TZ(NOW(), '+00:00', '+05:30'), '%Y-%m-%d') as today");
        const todayIST = dateRows[0].today;
        const targetDate = collection_date || todayIST;

        const istNow = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
        const currentISTTime = istNow.toISOString().slice(11, 19);
        const mysqlDate = collection_date
            ? `${collection_date} ${currentISTTime}`
            : istNow.toISOString().slice(0, 19).replace('T', ' ');

        const payMethod = (payment_method || 'Cash').toUpperCase();
        const isDiscount = payMethod === 'DISCOUNT';
        const isDigital = !isDiscount && (
            payMethod.includes('UPI') || payMethod.includes('GPAY') || 
            payMethod.includes('PHONEPE') || payMethod.includes('PAYTM') || 
            payMethod.includes('CHEQUE') || payMethod.includes('CHECK')
        );

        const approvalStatus = isDigital ? 'PENDING' : 'APPROVED';
        const affectsBalance = !isDigital;

        const resultDetails = [];

        for (const allocation of allocations) {
            const shopId = Number(allocation.shop_id);
            const allocationAmount = parseFloat(allocation.amount);

            if (isNaN(allocationAmount) || allocationAmount <= 0) {
                continue; // Skip zero/negative allocations
            }

            // A. Fetch current shop and balance
            const [shops] = await connection.query(`
                SELECT s.id, s.shop_name, s.village_name, s.order_line_id, COALESCE(sb.balance, 0) as balance, s.owner_name as specific_area
                FROM shops s
                LEFT JOIN shop_balances sb ON s.id = sb.shop_id
                WHERE s.id = ? FOR UPDATE
            `, [shopId]);

            if (shops.length === 0) {
                throw new Error(`Shop with ID ${shopId} not found.`);
            }
            const shop = shops[0];

            let shopOrderLineId = shop.order_line_id;
            if (!shopOrderLineId) {
                const [ols] = await connection.query('SELECT id FROM order_lines WHERE TRIM(name) = TRIM(?) LIMIT 1', [shop.village_name]);
                if (ols.length > 0) {
                    shopOrderLineId = ols[0].id;
                }
            }
            if (!shopOrderLineId) {
                throw new Error(`Shop "${shop.shop_name}" is not linked to any Order Line.`);
            }

            const currentBalance = parseFloat(shop.balance) || 0;

            // B. Payment Shield: check active debt
            const [collRows] = await connection.query(
                "SELECT total_balance FROM daily_collections WHERE shop_id = ? AND collection_date = ?",
                [shopId, targetDate]
            );
            const activeDebt = collRows.length > 0 ? parseFloat(collRows[0].total_balance) : currentBalance;

            if (allocationAmount > activeDebt + 0.01) {
                throw new Error(`Amount of ₹${allocationAmount.toFixed(2)} allocated to "${shop.shop_name}" exceeds its maximum collectible amount of ₹${activeDebt.toFixed(2)}.`);
            }

            const newBalance = affectsBalance ? currentBalance - allocationAmount : currentBalance;

            // C. Update balance
            if (affectsBalance) {
                await connection.query(
                    'UPDATE shop_balances SET balance = ? WHERE shop_id = ?',
                    [newBalance, shopId]
                );
            }

            // D. Insert Transaction
            const txDesc = description || `Split Payment Received (${payMethod})`;
            await connection.query(
                `INSERT INTO shop_transactions 
                    (shop_id, type, amount, payment_mode, transaction_category, description, 
                     balance_after, approval_status, affects_balance, created_by, transaction_date) 
                 VALUES (?, 'Payment', ?, ?, 'PAYMENT', ?, ?, ?, ?, ?, ?)`,
                [shopId, allocationAmount, payMethod, txDesc, 
                 newBalance, approvalStatus, affectsBalance, actingUserName, mysqlDate]
            );

            // E. Update daily collections
            if (affectsBalance) {
                if (isDiscount) {
                    await connection.query(`
                        INSERT INTO daily_collections
                            (shop_id, shop_name, village_name, order_line_id, collection_date,
                             manual_adjustments, old_balance, total_balance, future_bills)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
                        ON DUPLICATE KEY UPDATE
                            manual_adjustments = manual_adjustments + VALUES(manual_adjustments),
                            total_balance = old_balance + todays_bill_amount - (cash_collected + upi_collected + cheque_collected) + manual_adjustments
                    `, [shopId, shop.shop_name, shop.village_name, shopOrderLineId,
                        targetDate, -allocationAmount, currentBalance, newBalance]);
                } else {
                    const c = payMethod === 'CASH' ? allocationAmount : 0;
                    const u = ['UPI', 'PHONEPE', 'GPAY', 'PAYTM', 'OTHER UPI'].includes(payMethod) ? allocationAmount : 0;
                    const q = payMethod === 'CHEQUE' ? allocationAmount : 0;

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
                    `, [shopId, shop.shop_name, shop.village_name, shopOrderLineId,
                        targetDate, c, u, q, currentBalance, newBalance]);
                }

                // Recalculate ripple sequentially
                await financialService.rebuildRipple(connection, shopId, targetDate);
            }

            // F. Trigger webhook notification
            webhookService.sendTransactionToWebhook({
                shop_id: shopId,
                shop_name: shop.shop_name,
                village_name: shop.village_name,
                specific_area: shop.specific_area,
                type: 'Payment',
                amount: -allocationAmount,
                payment_method: payMethod,
                description: txDesc + (isDigital ? ' (PENDING APPROVAL)' : ''),
                balance_before: currentBalance,
                balance_after: newBalance,
                created_by: actingUserName
            });

            resultDetails.push({
                shop_id: shopId,
                shop_name: shop.shop_name,
                allocated_amount: allocationAmount,
                new_balance: newBalance
            });
        }

        await connection.commit();
        cacheService.flush();

        res.json({
            message: isDigital ? 'Split payments submitted for Admin approval.' : 'Split payments recorded successfully.',
            status: approvalStatus,
            allocations: resultDetails
        });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('collectSplitPayment error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) connection.release();
    }
};
