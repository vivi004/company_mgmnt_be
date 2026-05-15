require('dotenv').config();
const db = require('../src/config/db');

async function checkTodayBills() {
    try {
        const [rows] = await db.query(`
            SELECT id, shop_name, village_name, total_amount, created_by, bill_date
            FROM bills
            WHERE shop_id = 122 AND DATE(CONVERT_TZ(bill_date, '+00:00', '+05:30')) = '2026-05-15'
        `);
        console.log(JSON.stringify(rows, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

checkTodayBills();
