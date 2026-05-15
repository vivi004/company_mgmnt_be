require('dotenv').config();
const db = require('../src/config/db');

async function checkTodayTxs() {
    try {
        const [rows] = await db.query(`
            SELECT id, description, created_by, amount, type, payment_mode, transaction_date
            FROM shop_transactions
            WHERE shop_id = 122 AND DATE(CONVERT_TZ(transaction_date, '+00:00', '+05:30')) = '2026-05-15'
        `);
        console.log(JSON.stringify(rows, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

checkTodayTxs();
