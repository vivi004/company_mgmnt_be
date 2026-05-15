require('dotenv').config();
const db = require('../src/config/db');

async function checkApprovers() {
    try {
        const [rows] = await db.query(`
            SELECT id, description, created_by, approved_by, amount, type, transaction_date
            FROM shop_transactions
            WHERE shop_id = 122
            ORDER BY transaction_date DESC
        `);
        console.log(JSON.stringify(rows, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

checkApprovers();
