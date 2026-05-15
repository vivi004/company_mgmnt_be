require('dotenv').config();
const db = require('../src/config/db');
const { rebuildRipple } = require('../src/services/financialService');
const webhookService = require('../src/services/webhookService');

async function syncLedger() {
    const shopId = 122;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Find and Approve PENDING transactions for Shop 122
        const [pending] = await connection.query(
            'SELECT * FROM shop_transactions WHERE shop_id = ? AND approval_status = "PENDING"',
            [shopId]
        );
        
        console.log(`Found ${pending.length} pending transactions to approve.`);

        for (const tx of pending) {
            const istApproveTime = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
            const istApproveStr = istApproveTime.toISOString().slice(0, 19).replace('T', ' ');
            
            await connection.query(
                `UPDATE shop_transactions SET 
                 approval_status = 'APPROVED', 
                 affects_balance = TRUE, 
                 approved_by = 'System Sync', 
                 approved_at = ?
                 WHERE id = ?`,
                [istApproveStr, tx.id]
            );
            console.log(`Approved transaction #${tx.id} (${tx.description})`);
            
            // Trigger webhook for these new approvals
            webhookService.sendTransactionToWebhook({
                shop_id: tx.shop_id,
                shop_name: 'ALAGHUNACHI',
                village_name: 'SATHYAMANGALAM',
                type: tx.type,
                amount: tx.transaction_category === 'PAYMENT' ? -parseFloat(tx.amount) : parseFloat(tx.amount),
                payment_method: tx.payment_mode,
                description: tx.description + ' (APPROVED)',
                balance_before: 0, // Placeholder, rebuildRipple will fix balance_after in DB
                balance_after: 0,
                created_by: 'System Sync'
            });
        }

        // 2. Re-send webhooks for the specific PhonePe payments mentioned in the sheet
        // Row 11 (ID 219?), Row 14 (ID 222?), Row 19 (ID 225?), Row 21 (ID 226?)
        const phonePeTxIds = [219, 222, 225, 226];
        const [txs] = await connection.query(
            'SELECT * FROM shop_transactions WHERE id IN (?)',
            [phonePeTxIds]
        );

        for (const tx of txs) {
            console.log(`Re-sending approval webhook for #${tx.id} (${tx.description})`);
            webhookService.sendTransactionToWebhook({
                shop_id: tx.shop_id,
                shop_name: 'ALAGHUNACHI',
                village_name: 'SATHYAMANGALAM',
                type: tx.type,
                amount: -parseFloat(tx.amount),
                payment_method: tx.payment_mode,
                description: tx.description + ' (APPROVED)',
                balance_before: 0,
                balance_after: 0,
                created_by: 'System Sync'
            });
        }

        // 3. Rebuild Ripple from the beginning of history for this shop
        // Earliest transaction is 05-13
        await rebuildRipple(connection, shopId, '2026-05-12');
        console.log('Ripple rebuild completed.');

        await connection.commit();
        console.log('All changes committed successfully.');
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Sync failed:', err);
    } finally {
        if (connection) connection.release();
        process.exit();
    }
}

syncLedger();
