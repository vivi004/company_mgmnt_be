require('dotenv').config();
const db = require('../src/config/db');
const webhookService = require('../src/services/webhookService');

async function run() {
    const args = process.argv.slice(2);
    let invoices = [];
    let date = null;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--invoices' && args[i + 1]) {
            invoices = args[i + 1].split(',').map(x => x.trim());
        }
        if (args[i] === '--date' && args[i + 1]) {
            date = args[i + 1].trim();
        }
    }

    if (invoices.length === 0 && !date) {
        console.log('Usage:');
        console.log('  node scripts/re_sync_bills.js --invoices 1533,1534');
        console.log('  node scripts/re_sync_bills.js --date 2026-06-27');
        process.exit(1);
    }

    const connection = await db.getConnection();
    try {
        let query = '';
        let params = [];

        if (invoices.length > 0) {
            console.log(`Searching for transactions matching invoice numbers: ${invoices.join(', ')}`);
            query = `
                UPDATE shop_transactions t
                JOIN bills b ON (t.reference_id = b.id OR t.description LIKE CONCAT('%Invoice #', b.invoice_no, '%'))
                SET t.is_synced_to_sheet = 0
                WHERE t.type = 'Bill' AND b.invoice_no IN (?)
            `;
            params = [invoices];
        } else if (date) {
            console.log(`Searching for transactions matching delivery date: ${date}`);
            query = `
                UPDATE shop_transactions t
                JOIN bills b ON (t.reference_id = b.id OR t.description LIKE CONCAT('%Invoice #', b.invoice_no, '%'))
                SET t.is_synced_to_sheet = 0
                WHERE t.type = 'Bill' AND DATE(b.delivery_date) = ?
            `;
            params = [date];
        }

        const [result] = await connection.query(query, params);
        console.log(`Successfully marked ${result.affectedRows} transaction(s) as unsynced (is_synced_to_sheet = 0).`);

        if (result.affectedRows > 0) {
            console.log('Triggering webhook sync catchup to push them to Google Sheets...');
            await webhookService.retryFailedSyncs();
            console.log('Sync process completed.');
        } else {
            console.log('No matching transactions found to re-sync.');
        }

    } catch (err) {
        console.error('Error during re-sync execution:', err.message);
    } finally {
        connection.release();
        process.exit(0);
    }
}

run();
