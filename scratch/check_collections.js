require('dotenv').config();
const db = require('../src/config/db');

async function getDailyCollections() {
    try {
        const [rows] = await db.query(`
            SELECT id, collection_date, todays_bill_amount, cash_collected, upi_collected, cheque_collected, old_balance, total_balance, manual_adjustments
            FROM daily_collections
            WHERE shop_id = 122
            ORDER BY collection_date DESC
        `);
        console.log(JSON.stringify(rows, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

getDailyCollections();
