const cron = require('node-cron');
const db = require('../config/db');
const financialService = require('./financialService');
const webhookService = require('./webhookService');
const googleSheetSyncService = require('./googleSheetSyncService');
const googleAuthService = require('./googleAuthService');

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

    try {
        // Find all bills due today that haven't been applied yet
        const [dueBills] = await db.query(`
            SELECT b.id, b.shop_id, b.shop_name, b.village_name, b.total_amount, b.created_by,
                   s.order_line_id, COALESCE(sb.balance, 0) as current_balance
            FROM bills b
            JOIN shops s ON b.shop_id = s.id
            LEFT JOIN shop_balances sb ON s.id = sb.shop_id
            WHERE DATE(CONVERT_TZ(b.delivery_date, '+00:00', '+05:30')) = ?
              AND b.is_applied_to_balance = 0
        `, [todayIST]);

        if (dueBills.length === 0) {
            console.log('[CRON] No pending delivery-date bills to apply.');
            return;
        }

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            // Compute IST timestamp once for all entries in this batch
            const istNow = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
            const istTimestamp = istNow.toISOString().slice(0, 19).replace('T', ' ');

            for (const bill of dueBills) {
                const amount = parseFloat(bill.total_amount) || 0;
                const newBalance = parseFloat(bill.current_balance) + amount;

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
                    todayIST, amount, parseFloat(bill.current_balance), newBalance]);

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
                    balance_before: bill.current_balance,
                    balance_after: newBalance,
                    created_by: bill.created_by || 'System',
                    reference_id: bill.id
                });

                // 6. MASTER SYNC: Ripple forward from today
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
    } catch (err) {
        console.error('[CRON] applyDueBills error:', err.message);
    }
}

/**
 * Start all scheduled tasks.
 * Cron at 18:30 UTC = 00:00 IST daily.
 */
function startScheduler() {
    // 1. Midnight IST Rollover (00:00 IST = 18:30 UTC)
    cron.schedule('30 18 * * *', async () => {
        console.log('[CRON] Midnight IST triggered.');
        await applyDueBills();      // Apply delivery-date bills first
        await runMidnightRollover(); // Then roll over balances
    }, {
        timezone: 'UTC'
    });

    console.log('[SCHEDULER] Midnight IST rollover scheduled (18:30 UTC = 00:00 IST).');

    // 2. Google Sheets Background Sync Scheduler: Runs every 10 minutes
    cron.schedule('*/10 * * * *', async () => {
        console.log('[CRON] 10-Minute Google Sheets Sync triggered.');
        await googleSheetSyncService.syncGoogleSheetsRates();
    });
    console.log('[SCHEDULER] 10-minute Google Sheets Background Sync scheduled.');

    // 3. Startup Actions: Validate Google Service Account credentials & run initial sync
    setTimeout(async () => {
        googleAuthService.validateCredentials();
        console.log('[SCHEDULER] Executing initial Google Sheet Sync on server boot...');
        await googleSheetSyncService.syncGoogleSheetsRates();
    }, 2000);
}

module.exports = { startScheduler, runMidnightRollover, applyDueBills };
