const cron = require('node-cron');
const db = require('../config/db');
const financialService = require('./financialService');
const webhookService = require('./webhookService');

/**
 * Helper: Get current IST date string (YYYY-MM-DD)
 */
function getISTDateString(offsetDays = 0) {
    const now = new Date();
    // Add a 30-second safety padding to prevent clock drift during cron execution near midnight
    const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000 + 30000 + offsetDays * 24 * 60 * 60 * 1000);
    return istNow.toISOString().split('T')[0];
}

/**
 * TASK 1: Midnight Rollover
 * (Refactored: Skip bulk seeding of empty 0.00 rows to prevent DB clutter and double entries.
 * All balance logic and reports compute balances dynamically when there's no transaction.)
 */
async function runMidnightRollover() {
    const todayIST = getISTDateString(0);
    console.log(`[CRON] Midnight rollover triggered for ${todayIST}. Skipping bulk 0-value pre-seeding to keep database clean and prevent double entries.`);
}

/**
 * TASK 2: Apply Delivery-Date Bills to shop_balances
 * At midnight, any bills whose delivery_date = today and is_applied_to_balance = 0
 * get their amount added to shop_balances and daily_collections for today.
 */
async function applyDueBills() {
    const todayIST = getISTDateString(0);
    const yesterdayIST = getISTDateString(-1);

    console.log(`[CRON] Applying due bills for delivery date: ${todayIST}`);

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Find all bills due today that haven't been applied yet, with FOR UPDATE lock on the rows
        const [dueBills] = await connection.query(`
            SELECT b.id, b.shop_id, b.shop_name, b.village_name, b.total_amount, b.created_by,
                   s.order_line_id, s.owner_name as specific_area, COALESCE(sb.balance, 0) as current_balance
            FROM bills b
            JOIN shops s ON b.shop_id = s.id
            LEFT JOIN shop_balances sb ON s.id = sb.shop_id
            WHERE DATE(CONVERT_TZ(b.delivery_date, '+00:00', '+05:30')) = ?
              AND b.is_applied_to_balance = 0
            FOR UPDATE
        `, [todayIST]);

        if (dueBills.length === 0) {
            console.log('[CRON] No pending delivery-date bills to apply.');
            await connection.commit();
            return;
        }

        // Compute IST timestamp once for all entries in this batch
        const istNow = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
        const istTimestamp = istNow.toISOString().slice(0, 19).replace('T', ' ');

        // ── GROUP by shop_id ──
        // This ensures rebuildRipple is called ONCE per shop (not once per bill),
        // preventing redundant intermediate ripple calls that corrupt daily_collections.
        const billsByShop = {};
        for (const bill of dueBills) {
            if (!billsByShop[bill.shop_id]) billsByShop[bill.shop_id] = [];
            billsByShop[bill.shop_id].push(bill);
        }

        // Collect webhook payloads — sent AFTER commit with ripple-corrected balance_after values
        const pendingWebhooks = [];

        for (const shopId of Object.keys(billsByShop)) {
            const shopBills = billsByShop[shopId];
            const insertedTxIds = []; // Track IDs so we can re-read corrected balance_after after ripple

            // Re-read current balance fresh for this shop (inside the transaction for lock consistency)
            const [shopBalanceRows] = await connection.query(
                'SELECT COALESCE(balance, 0) as balance FROM shop_balances WHERE shop_id = ? FOR UPDATE',
                [shopId]
            );
            let runningBalance = shopBalanceRows.length > 0 ? parseFloat(shopBalanceRows[0].balance) : 0;

            for (const bill of shopBills) {
                const amount = parseFloat(bill.total_amount) || 0;
                const balanceBefore = runningBalance;
                runningBalance += amount;

                // 1. Apply to shop_balances (each bill chains from the previous)
                await connection.query(
                    'INSERT INTO shop_balances (shop_id, balance) VALUES (?, ?) ON DUPLICATE KEY UPDATE balance = VALUES(balance)',
                    [shopId, runningBalance]
                );

                // 2. Log ledger entry (use explicit IST timestamp, not NOW() which uses server tz)
                const [txResult] = await connection.query(
                    'INSERT INTO shop_transactions (shop_id, type, amount, reference_id, description, balance_after, created_by, transaction_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [bill.shop_id, 'Bill', amount, bill.id, `Delivery Due — Invoice Applied`, runningBalance, bill.created_by || 'System', istTimestamp]
                );
                insertedTxIds.push(txResult.insertId);

                // 3. Update daily_collections for today — add to todays_bill_amount + total_balance
                await connection.query(`
                    INSERT INTO daily_collections
                        (shop_id, shop_name, village_name, order_line_id, collection_date,
                         todays_bill_amount, old_balance, total_balance, future_bills, manual_adjustments)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
                    ON DUPLICATE KEY UPDATE
                        todays_bill_amount = todays_bill_amount + VALUES(todays_bill_amount),
                        total_balance = old_balance + todays_bill_amount - (cash_collected + upi_collected + cheque_collected) + manual_adjustments
                `, [bill.shop_id, bill.shop_name, bill.village_name, bill.order_line_id,
                    todayIST, amount, balanceBefore, runningBalance]);

                // 4. Also remove from yesterday's future_bills (if it was tracked there)
                await connection.query(`
                    UPDATE daily_collections
                    SET future_bills = GREATEST(0, future_bills - ?)
                    WHERE shop_id = ? AND collection_date = ?
                `, [amount, bill.shop_id, yesterdayIST]);

                // 5. Mark bill as applied
                await connection.query(
                    'UPDATE bills SET is_applied_to_balance = 1 WHERE id = ?',
                    [bill.id]
                );

                // Queue webhook payload (balance_after is provisional — overwritten after ripple)
                pendingWebhooks.push({
                    tx_id: txResult.insertId,
                    shop_id: bill.shop_id,
                    shop_name: bill.shop_name,
                    village_name: bill.village_name,
                    specific_area: bill.specific_area || '',
                    type: 'Bill',
                    amount: amount,
                    description: `Delivery Due — Invoice Applied`,
                    balance_before: balanceBefore,
                    balance_after: runningBalance, // Provisional — corrected after rebuildRipple below
                    created_by: bill.created_by || 'System'
                });
            }

            // 6. MASTER SYNC: Ripple forward from today — called ONCE per shop, not once per bill
            await financialService.rebuildRipple(connection, parseInt(shopId), todayIST);

            // 7. Re-read ripple-corrected balance_after for all transactions inserted for this shop
            if (insertedTxIds.length > 0) {
                const [correctedRows] = await connection.query(
                    'SELECT id, balance_after FROM shop_transactions WHERE id IN (?)',
                    [insertedTxIds]
                );
                const correctedMap = {};
                correctedRows.forEach(r => { correctedMap[r.id] = parseFloat(r.balance_after); });

                // Update provisional balance_after in pending webhooks with ripple-verified values
                for (const pw of pendingWebhooks) {
                    if (insertedTxIds.includes(pw.tx_id)) {
                        pw.balance_after = correctedMap[pw.tx_id] ?? pw.balance_after;
                    }
                }
            }
        }

        await connection.commit();
        console.log(`[CRON] Applied ${dueBills.length} delivery-date bills to shop balances.`);

        // 8. Send all webhooks AFTER commit, with ripple-corrected balance_after values
        for (const payload of pendingWebhooks) {
            const { tx_id, ...webhookData } = payload; // Strip internal tx_id before sending
            webhookService.sendTransactionToWebhook(webhookData);
        }

    } catch (err) {
        await connection.rollback();
        console.error('[CRON] applyDueBills transaction error:', err.message);
    } finally {
        connection.release();
    }
}


/**
 * TASK 3: Prune Ledger Transactions older than 3 months (90 days)
 * Automatically keeps only last 3 months records in shop_transactions, 
 * while carrying forward the balance_after as the new opening_balance in shop_balances.
 */
async function pruneOldLedgerTransactions() {
    console.log('[CRON] Pruning ledger transactions older than 3 months...');
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get current date minus 90 days in IST
        const istNow = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
        const pruneThresholdDate = new Date(istNow.getTime() - 90 * 24 * 60 * 60 * 1000);
        const thresholdStr = pruneThresholdDate.toISOString().slice(0, 19).replace('T', ' ');

        // 2. Find the latest transaction for each shop that is older than the threshold and not pending
        const [lastOldTxs] = await connection.query(`
            SELECT t1.shop_id, t1.balance_after, t1.transaction_date
            FROM shop_transactions t1
            INNER JOIN (
                SELECT shop_id, MAX(id) as max_id
                FROM shop_transactions
                WHERE transaction_date < ?
                  AND approval_status != 'PENDING'
                GROUP BY shop_id
            ) t2 ON t1.id = t2.max_id
            FOR UPDATE
        `, [thresholdStr]);

        if (lastOldTxs.length === 0) {
            console.log('[CRON] No old ledger transactions to prune.');
            await connection.commit();
            return;
        }

        console.log(`[CRON] Found old transactions for ${lastOldTxs.length} shops to carry forward & prune.`);

        // 3. For each shop, update the opening_balance to be the balance_after of the latest pruned transaction
        // Group-aware optimization: For linked shops, only carry forward the single latest transaction balance for the group to prevent double counting.
        const [shops] = await connection.query('SELECT id, parent_shop_id FROM shops');
        const shopToParentMap = {};
        for (const s of shops) {
            shopToParentMap[s.id] = s.parent_shop_id || s.id;
        }

        const groupLatestTx = {};
        for (const tx of lastOldTxs) {
            const parentId = shopToParentMap[tx.shop_id] || tx.shop_id;
            if (!groupLatestTx[parentId] || new Date(tx.transaction_date) > new Date(groupLatestTx[parentId].transaction_date)) {
                groupLatestTx[parentId] = tx;
            }
        }

        for (const parentId of Object.keys(groupLatestTx)) {
            const newOpeningBal = parseFloat(groupLatestTx[parentId].balance_after) || 0;
            const groupShopIds = shops.filter(s => (s.parent_shop_id || s.id) === parseInt(parentId)).map(s => s.id);
            for (const shopId of groupShopIds) {
                await connection.query(`
                    INSERT INTO shop_balances (shop_id, balance, opening_balance) 
                    VALUES (?, ?, ?) 
                    ON DUPLICATE KEY UPDATE opening_balance = VALUES(opening_balance)
                `, [shopId, newOpeningBal, newOpeningBal]);
            }
        }

        // 4. Delete all transactions older than the threshold
        const [deleteResult] = await connection.query(`
            DELETE FROM shop_transactions 
            WHERE transaction_date < ?
              AND approval_status != 'PENDING'
        `, [thresholdStr]);

        // 5. Clean up redundant 0-value daily collection records to prevent database bloat
        const [pruneDcResult] = await connection.query(`
            DELETE FROM daily_collections 
            WHERE todays_bill_amount = 0 
              AND cash_collected = 0 
              AND upi_collected = 0 
              AND cheque_collected = 0 
              AND manual_adjustments = 0 
              AND return_amount = 0
        `);

        await connection.commit();
        console.log(`[CRON] Pruned ${deleteResult.affectedRows} transactions older than 3 months.`);
        console.log(`[CRON] Cleaned up ${pruneDcResult.affectedRows || 0} redundant 0-value daily collection records.`);
    } catch (err) {
        await connection.rollback();
        console.error('[CRON] pruneOldLedgerTransactions error:', err.message);
    } finally {
        connection.release();
    }
}

/**
 * Start all scheduled tasks.
 * Cron at 18:30 UTC = 00:00 IST daily.
 */
function startScheduler() {
    // 00:00 IST = 18:30 UTC → cron: '30 18 * * *'
    cron.schedule('30 18 * * *', async () => {
        console.log('[CRON] Midnight IST triggered.');
        await applyDueBills();              // Apply delivery-date bills first
        await runMidnightRollover();         // Then roll over balances
        await pruneOldLedgerTransactions();  // And prune old transactions
    }, {
        timezone: 'UTC'
    });

    console.log('[SCHEDULER] Midnight IST rollover scheduled (18:30 UTC = 00:00 IST).');

    // Webhook Sync Retry Cron: runs every 15 minutes to catch up unsynced ledger transactions
    cron.schedule('*/15 * * * *', async () => {
        try {
            await webhookService.retryFailedSyncs();
        } catch (e) {
            console.error('[SCHEDULER] Background sync retry cron failed:', e.message);
        }
    });
    console.log('[SCHEDULER] Webhook Sync Failure Queue (Automatic Catchup) scheduled every 15 minutes.');

    // Also run it once immediately on server startup to clean up historical data right away!
    setTimeout(async () => {
        try {
            await pruneOldLedgerTransactions();
        } catch (e) {
            console.error('[SCHEDULER] Immediate startup prune failed:', e.message);
        }
    }, 5000);

    // Run the webhook retry task on startup after a brief delay
    setTimeout(async () => {
        try {
            await webhookService.retryFailedSyncs();
        } catch (e) {
            console.error('[SCHEDULER] Immediate startup webhook retry failed:', e.message);
        }
    }, 10000);
}

module.exports = { startScheduler, runMidnightRollover, applyDueBills, pruneOldLedgerTransactions };
