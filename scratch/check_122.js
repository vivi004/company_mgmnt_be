require('dotenv').config();
const db = require('../src/config/db');

async function check() {
    try {
        const [txs] = await db.query('SELECT * FROM shop_transactions WHERE shop_id = 122 AND type = "Bill"');
        console.log('Transactions for shop 122:');
        console.log(JSON.stringify(txs, null, 2));

        const [bills] = await db.query('SELECT id, is_applied_to_balance FROM bills WHERE shop_id = 122');
        console.log('Bills for shop 122:');
        console.log(JSON.stringify(bills, null, 2));
        
        process.exit(0);
    } catch (e) {
        process.exit(1);
    }
}
check();
