require('dotenv').config();
const db = require('./config/db');

async function check() {
    try {
        const [rows] = await db.query(`
            SELECT id, shop_name, owner_name, village_name, order_line_id
            FROM shops 
            WHERE owner_name = 'KOVAI PERIVU' OR village_name = 'KOVAI PERIVU'
        `);
        console.log('Shops with KOVAI PERIVU:');
        console.log(rows);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
check();
