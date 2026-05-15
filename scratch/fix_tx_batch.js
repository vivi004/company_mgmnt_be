require('dotenv').config();
const db = require('../src/config/db');
const webhookService = require('../src/services/webhookService');

async function fixMultipleTransactions() {
    const txIds = [229, 230, 231];
    const newCreatedBy = 'Ravi S';
    
    try {
        for (const txId of txIds) {
            // 1. Get old details to update description correctly
            const [oldRows] = await db.query('SELECT description FROM shop_transactions WHERE id = ?', [txId]);
            let oldDesc = oldRows[0].description;
            let newDesc = oldDesc.replace('Pradap k', 'Ravi S');
            if (!newDesc.includes('(APPROVED)')) newDesc += ' (APPROVED)';

            // 2. Update database
            await db.query(
                'UPDATE shop_transactions SET created_by = ?, description = ? WHERE id = ?',
                [newCreatedBy, newDesc, txId]
            );
            console.log(`Updated transaction #${txId} in database.`);

            // 3. Fetch full details for webhook
            const [rows] = await db.query(`
                SELECT t.*, s.shop_name, s.village_name, s.owner_name as specific_area
                FROM shop_transactions t
                JOIN shops s ON t.shop_id = s.id
                WHERE t.id = ?
            `, [txId]);
            
            const tx = rows[0];

            // 4. Send to webhook
            webhookService.sendTransactionToWebhook({
                shop_id: tx.shop_id,
                shop_name: tx.shop_name,
                village_name: tx.village_name,
                specific_area: tx.specific_area,
                type: tx.type,
                amount: tx.type === 'Payment' ? -parseFloat(tx.amount) : parseFloat(tx.amount),
                payment_method: tx.payment_mode,
                description: tx.description,
                balance_before: 0,
                balance_after: 0,
                created_by: tx.created_by
            });
            console.log(`Sent correction for #${txId} to webhook.`);
        }
    } catch (err) {
        console.error('Batch fix failed:', err);
    } finally {
        process.exit();
    }
}

fixMultipleTransactions();
