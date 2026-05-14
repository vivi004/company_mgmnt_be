require('dotenv').config();
const db = require('../src/config/db');

async function check() {
    try {
        const [rows] = await db.query('SELECT * FROM shop_transactions WHERE type = "Bill" AND reference_id = 57');
        console.log('Transaction for bill 57:');
        console.log(JSON.stringify(rows, null, 2));
        process.exit(0);
    } catch (e) {
        process.exit(1);
    }
}
check();
