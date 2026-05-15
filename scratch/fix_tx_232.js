require('dotenv').config();
const db = require('../src/config/db');
const webhookService = require('../src/services/webhookService');

async function fixTransaction() {
    const txId = 232;
    const newCreatedBy = 'Ravi S';
    const newDescription = 'Cheque payment collected by Ravi S (APPROVED)';
    
    try {
        // 1. Update database
        await db.query(
            'UPDATE shop_transactions SET created_by = ?, description = ? WHERE id = ?',
            [newCreatedBy, newDescription, txId]
        );
        console.log(`Updated transaction #${txId} in database.`);

        // 2. Fetch updated details for webhook
        const [rows] = await db.query(`
            SELECT t.*, s.shop_name, s.village_name, s.owner_name as specific_area
            FROM shop_transactions t
            JOIN shops s ON t.shop_id = s.id
            WHERE t.id = ?
        `, [txId]);
        
        const tx = rows[0];

        // 3. Send update to webhook (Note: Sheet appends, so this will be a new row showing the fix)
        webhookService.sendTransactionToWebhook({
            shop_id: tx.shop_id,
            shop_name: tx.shop_name,
            village_name: tx.village_name,
            specific_area: tx.specific_area,
            type: tx.type,
            amount: -parseFloat(tx.amount), // Payments are negative in sheet
            payment_method: tx.payment_mode,
            description: tx.description, // Already has (APPROVED)
            balance_before: 0,
            balance_after: 0,
            created_by: tx.created_by
        });
        console.log('Sent correction to webhook.');

    } catch (err) {
        console.error('Fix failed:', err);
    } finally {
        process.exit();
    }
}

fixTransaction();
