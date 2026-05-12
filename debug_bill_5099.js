const dotenv = require('dotenv');
dotenv.config({ path: './.env' });
const db = require('./src/config/db');

async function debugBill() {
    try {
        const [bills] = await db.query(`
            SELECT b.*, s.owner_name as specific_area, s.shop_name as shop_name_joined, s.village_name as village_name_joined
            FROM bills b
            LEFT JOIN shops s ON b.shop_id = s.id
            WHERE b.invoice_no = 5099
        `);
        console.log('Bill Debug Info:', JSON.stringify(bills, null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
debugBill();
