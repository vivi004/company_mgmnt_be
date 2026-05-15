require('dotenv').config();
const db = require('../src/config/db');

async function getUnverifiedBills() {
    try {
        const [rows] = await db.query(`
            SELECT id, shop_id, shop_name, village_name, total_amount, bill_date, status
            FROM bills
            WHERE status = 'Unverified'
        `);
        console.log(JSON.stringify(rows, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

getUnverifiedBills();
