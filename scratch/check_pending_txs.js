require('dotenv').config();
const db = require('../src/config/db');

async function checkPendingTransactions() {
    try {
        const [rows] = await db.query(`
            SELECT t.id, t.shop_id, s.shop_name, s.village_name, t.amount, t.description, t.payment_mode, t.transaction_date, t.type
            FROM shop_transactions t
            JOIN shops s ON t.shop_id = s.id
            WHERE t.approval_status = 'PENDING'
        `);
        console.log(JSON.stringify(rows, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

checkPendingTransactions();
