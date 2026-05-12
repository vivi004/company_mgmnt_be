require('dotenv').config();
const db = require('./config/db');

async function check() {
    try {
        const [rows] = await db.query(`
            SELECT owner_name, village_name, order_line_id
            FROM shops 
            WHERE order_line_id != 36 
            LIMIT 20
        `);
        console.log('Other shops:');
        console.log(rows);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
check();
