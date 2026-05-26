const db = require('../config/db');
const financialService = require('../services/financialService');
const webhookService = require('../services/webhookService');
const cacheService = require('../services/cacheService');

// GET all pending transactions for Admin
const getPendingTransactions = async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT t.id, t.shop_id, t.type, t.amount, t.payment_mode, t.payment_method, 
                   t.transaction_category, t.description, t.transaction_date, t.created_by,
                   s.shop_name, s.village_name
            FROM shop_transactions t
            JOIN shops s ON t.shop_id = s.id
            WHERE t.approval_status = 'PENDING'
            ORDER BY t.transaction_date DESC, t.id DESC
        `);
        res.json(rows);
    } catch (err) {
        console.error('getPendingTransactions error:', err);
        res.status(500).json({ error: 'Failed to fetch pending transactions' });
    }
};

// POST Bulk approve pending transactions
const approveTransactionsBulk = async (req, res) => {
    const { tx_ids } = req.body;
    if (!Array.isArray(tx_ids) || tx_ids.length === 0) {
        return res.status(400).json({ error: 'tx_ids must be a non-empty array' });
    }

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

        // 1. Get and lock these transactions
        const [txs] = await connection.query(
            `SELECT id, shop_id, type, amount, payment_mode, transaction_category, description, 
                    balance_after, approval_status, affects_balance, created_by, transaction_date 
             FROM shop_transactions 
             WHERE id IN (?) AND approval_status = 'PENDING'
             FOR UPDATE`,
            [tx_ids]
        );

        if (txs.length === 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'No pending transactions found for the provided IDs' });
        }

        // Group transactions by shop_id to process them chronologically
        const txsByShop = {};
        txs.forEach(tx => {
            if (!txsByShop[tx.shop_id]) {
                txsByShop[tx.shop_id] = [];
            }
            txsByShop[tx.shop_id].push(tx);
        });

        const results = [];
        const allPendingWebhooks = []; // Collect webhooks to send AFTER rebuildRipple corrects balance_after

        // For each shop, process approvals sequentially
        for (const shopId of Object.keys(txsByShop)) {
            const shopTxs = txsByShop[shopId];
            const shopWebhooks = []; // Per-shop webhook queue — populated before ripple, sent after

            // Get Shop and lock
            const [shops] = await connection.query(`
                SELECT s.id, s.order_line_id, s.shop_name, s.village_name, s.owner_name, s.created_at,
                       COALESCE(sb.balance, 0) as balance 
                FROM shops s 
                LEFT JOIN shop_balances sb ON s.id = sb.shop_id 
                WHERE s.id = ? FOR UPDATE
            `, [shopId]);
            const shop = shops[0];
            if (!shop) continue;

            let currentBalance = parseFloat(shop.balance);
            let earliestTxDate = null;

            // Sort transactions by date (earliest first)
            shopTxs.sort((a, b) => new Date(a.transaction_date).getTime() - new Date(b.transaction_date).getTime());

            for (const tx of shopTxs) {
                const amount = parseFloat(tx.amount);
                const isPayment = tx.transaction_category === 'PAYMENT';
                const balanceBefore = currentBalance;
                const newBalance = isPayment ? balanceBefore - amount : balanceBefore + amount;

                // Update tracker
                currentBalance = newBalance;

                if (!earliestTxDate || new Date(tx.transaction_date).getTime() < new Date(earliestTxDate).getTime()) {
                    earliestTxDate = tx.transaction_date;
                }

                // Update Transaction
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
                    [newBalance, actingUserName, istApproveStr, tx.id]
                );

                // Update daily_collections
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
                    `, [tx.shop_id, shop.shop_name, shop.village_name, shop.order_line_id, txDate, amount, balanceBefore, newBalance]);
                } else {
                    await connection.query(`
                        INSERT INTO daily_collections
                            (shop_id, shop_name, village_name, order_line_id, collection_date,
                             manual_adjustments, old_balance, total_balance)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE
                            manual_adjustments = manual_adjustments + VALUES(manual_adjustments),
                            total_balance = old_balance + todays_bill_amount - (cash_collected + upi_collected + cheque_collected) + manual_adjustments
                    `, [tx.shop_id, shop.shop_name, shop.village_name, shop.order_line_id, txDate, amount, balanceBefore, newBalance]);
                }

                results.push({ tx_id: tx.id, shop_id: tx.shop_id, status: 'APPROVED', new_balance: newBalance });

                // Queue webhook — balance_after will be updated after rebuildRipple corrects it
                shopWebhooks.push({
                    tx_id: tx.id, // Used to look up corrected balance_after after ripple
                    shop_id: tx.shop_id,
                    shop_name: shop.shop_name,
                    village_name: shop.village_name,
                    specific_area: shop.owner_name,
                    type: tx.type,
                    amount: isPayment ? -amount : amount,
                    payment_method: tx.payment_mode,
                    description: tx.description + ' (APPROVED)',
                    balance_before: balanceBefore,
                    created_by: actingUserName
                });
            }

            // Update shop_balances
            await connection.query(
                'INSERT INTO shop_balances (shop_id, balance) VALUES (?, ?) ON DUPLICATE KEY UPDATE balance = VALUES(balance)',
                [shopId, currentBalance]
            );

            // Rebuild ripple ONCE for this shop starting from earliest approved transaction
            if (earliestTxDate) {
                const [earliestRows] = await connection.query("SELECT DATE_FORMAT(?, '%Y-%m-%d') as tx_date", [earliestTxDate]);
                const earliestTxDateStr = earliestRows[0].tx_date;
                await financialService.rebuildRipple(connection, shopId, earliestTxDateStr);

                // Re-read ripple-corrected balance_after from DB for each transaction in this shop
                if (shopWebhooks.length > 0) {
                    const webhookTxIds = shopWebhooks.map(w => w.tx_id);
                    const [correctedRows] = await connection.query(
                        'SELECT id, balance_after FROM shop_transactions WHERE id IN (?)',
                        [webhookTxIds]
                    );
                    const correctedMap = {};
                    correctedRows.forEach(r => { correctedMap[r.id] = parseFloat(r.balance_after); });
                    shopWebhooks.forEach(w => {
                        allPendingWebhooks.push({ ...w, balance_after: correctedMap[w.tx_id] ?? 0 });
                    });
                }
            } else {
                // No ripple needed — copy webhooks with manually-computed balances as fallback
                shopWebhooks.forEach(w => allPendingWebhooks.push({ ...w, balance_after: currentBalance }));
            }
        }

        await connection.commit();
        cacheService.flush();

        // Send all queued webhooks AFTER commit, with ripple-corrected balance_after values
        for (const payload of allPendingWebhooks) {
            const { tx_id, ...webhookPayload } = payload; // Strip internal tx_id before sending
            webhookService.sendTransactionToWebhook(webhookPayload);
        }

        res.json({ message: `Successfully approved ${results.length} transactions`, results });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('approveTransactionsBulk error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) connection.release();
    }
};

module.exports = {
    getPendingTransactions,
    approveTransactionsBulk
};
