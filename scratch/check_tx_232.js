require('dotenv').config();
const db = require('../src/config/db');

async function checkTxDetails() {
    try {
        const [rows] = await db.query(`
            SELECT id, description, created_by, approved_by, amount, type, payment_mode
            FROM shop_transactions
            WHERE id = 232
        `);
        console.log(JSON.stringify(rows, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

checkTxDetails();
