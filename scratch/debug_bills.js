require('dotenv').config();
const db = require('../src/config/db');

async function check() {
    try {
        const [rows] = await db.query('SELECT id, total_amount, delivery_date, is_applied_to_balance FROM bills WHERE shop_id = 122 ORDER BY id DESC LIMIT 5');
        console.log(JSON.stringify(rows, null, 2));
        
        const [coll] = await db.query('SELECT * FROM daily_collections WHERE shop_id = 122 AND collection_date = "2026-05-14"');
        console.log('Daily Collection for today:');
        console.log(JSON.stringify(coll, null, 2));
        
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
check();
