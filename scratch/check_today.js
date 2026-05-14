require('dotenv').config();
const db = require('../src/config/db');

async function checkTodayCollection() {
    try {
        const [rows] = await db.query('SELECT * FROM daily_collections WHERE collection_date = ?', ['2026-05-14']);
        console.log("Daily Collections for today:", JSON.stringify(rows, null, 2));
        
        const [txs] = await db.query('SELECT * FROM shop_transactions WHERE DATE(transaction_date) = ?', ['2026-05-14']);
        console.log("Transactions for today:", JSON.stringify(txs, null, 2));

        process.exit(0);
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
}
checkTodayCollection();
