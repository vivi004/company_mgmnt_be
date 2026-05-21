const cron = require('node-cron');
const db = require('../config/db');
const financialService = require('./financialService');
const webhookService = require('./webhookService');

/**
 * Helper: Get current IST date string (YYYY-MM-DD)
 */
function getISTDateString(offsetDays = 0) {
    const now = new Date();
    const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000 + offsetDays * 24 * 60 * 60 * 1000);
    return istNow.toISOString().split('T')[0];
}

/**
 * TASK 1: Midnight Rollover
 * Carries yesterday's total_balance → today's old_balance for all shops.
 * Runs every day at 00:00 IST (18:30 UTC).
 */
async function runMidnightRollover() {
    const todayIST = getISTDateString(0);

    console.log(`[CRON] Running robust midnight rollover for ${todayIST}`);

    try {
        // This query seeds EVERY shop with a row for today.
        // It finds the most recent total_balance (from any previous date) and carries it forward as today's old_balance.
        await db.query(`
            INSERT INTO daily_collections 
                (shop_id, shop_name, village_name, order_line_id, collection_date, 
                 old_balance, todays_bill_amount, total_balance, future_bills, manual_adjustments)
            SELECT 
                s.id as shop_id, 
                s.shop_name, 
                s.village_name, 
                s.order_line_id, 
                ? as collection_date,
                COALESCE(prev.total_balance, COALESCE(sb.balance, 0)) as old_balance,
                0 as todays_bill_amount,
                COALESCE(prev.total_balance, COALESCE(sb.balance, 0)) as total_balance,
                0 as future_bills,
                0 as manual_adjustments
            FROM shops s
            LEFT JOIN shop_balances sb ON s.id = sb.shop_id
            LEFT JOIN (
                SELECT dc1.shop_id, dc1.total_balance
                FROM daily_collections dc1
                INNER JOIN (
                    SELECT shop_id, MAX(collection_date) as max_date
                    FROM daily_collections
                    WHERE collection_date < ?
                    GROUP BY shop_id
                ) dc2 ON dc1.shop_id = dc2.shop_id AND dc1.collection_date = dc2.max_date
            ) prev ON s.id = prev.shop_id
            WHERE s.order_line_id IS NOT NULL
            ON DUPLICATE KEY UPDATE
                old_balance = VALUES(old_balance),
                total_balance = old_balance + todays_bill_amount - (cash_collected + upi_collected + cheque_collected) + manual_adjustments
        `, [todayIST, todayIST]);

        console.log(`[CRON] Midnight rollover complete for all active shops.`);
    } catch (err) {
        console.error('[CRON] Midnight rollover error:', err.message);
    }
}

/**
 * TASK 2: Apply Delivery-Date Bills to shop_balances
 * At midnight, any bills whose delivery_date = today and is_applied_to_balance = 0
 * get their amount added to shop_balances and daily_collections for today.
 */
async function applyDueBills() {
    const todayIST = getISTDateString(0);

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

        for (const bill of dueBills) {
            const amount = parseFloat(bill.total_amount) || 0;
            
            // Query fresh current balance of the shop to avoid race condition/overwriting with concurrent bills
            const [shopBalanceRows] = await connection.query(
                'SELECT COALESCE(balance, 0) as balance FROM shop_balances WHERE shop_id = ? FOR UPDATE',
                [bill.shop_id]
            );
            const currentBalance = shopBalanceRows.length > 0 ? parseFloat(shopBalanceRows[0].balance) : 0;
            const newBalance = currentBalance + amount;

            // 1. Apply to shop_balances
            await connection.query(
                'INSERT INTO shop_balances (shop_id, balance) VALUES (?, ?) ON DUPLICATE KEY UPDATE balance = VALUES(balance)',
                [bill.shop_id, newBalance]
            );

            // 2. Log ledger entry (use explicit IST timestamp, not NOW() which uses server tz)
            await connection.query(
                'INSERT INTO shop_transactions (shop_id, type, amount, reference_id, description, balance_after, created_by, transaction_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [bill.shop_id, 'Bill', amount, bill.id, `Delivery Due — Invoice Applied`, newBalance, bill.created_by || 'System', istTimestamp]
            );

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
                todayIST, amount, currentBalance, newBalance]);

            // 4. Also remove from yesterday's future_bills (if it was tracked there)
            const yesterdayIST = getISTDateString(-1);
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

            // 6. Push to Ledger (Google Sheets)
            webhookService.sendTransactionToWebhook({
                shop_id: bill.shop_id,
                shop_name: bill.shop_name,
                village_name: bill.village_name,
                specific_area: bill.specific_area || '',
                type: 'Bill',
                amount: amount,
                description: `Delivery Due — Invoice Applied`,
                balance_before: currentBalance,
                balance_after: newBalance,
                created_by: bill.created_by || 'System',
                reference_id: bill.id
            });

            // 7. MASTER SYNC: Ripple forward from today
            await financialService.rebuildRipple(connection, bill.shop_id, todayIST);
        }

        await connection.commit();
        console.log(`[CRON] Applied ${dueBills.length} delivery-date bills to shop balances.`);
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
        for (const tx of lastOldTxs) {
            const shopId = tx.shop_id;
            const newOpeningBal = parseFloat(tx.balance_after) || 0;

            await connection.query(`
                INSERT INTO shop_balances (shop_id, balance, opening_balance) 
                VALUES (?, ?, ?) 
                ON DUPLICATE KEY UPDATE opening_balance = VALUES(opening_balance)
            `, [shopId, newOpeningBal, newOpeningBal]);
        }

        // 4. Delete all transactions older than the threshold
        const [deleteResult] = await connection.query(`
            DELETE FROM shop_transactions 
            WHERE transaction_date < ?
              AND approval_status != 'PENDING'
        `, [thresholdStr]);

        await connection.commit();
        console.log(`[CRON] Pruned ${deleteResult.affectedRows} transactions older than 3 months.`);
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

    // Also run it once immediately on server startup to clean up historical data right away!
    setTimeout(async () => {
        try {
            await pruneOldLedgerTransactions();
        } catch (e) {
            console.error('[SCHEDULER] Immediate startup prune failed:', e.message);
        }
    }, 5000);
}

module.exports = { startScheduler, runMidnightRollover, applyDueBills, pruneOldLedgerTransactions };
