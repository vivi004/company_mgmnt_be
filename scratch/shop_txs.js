require('dotenv').config();
const db = require('../src/config/db');

async function getShopTransactions() {
    try {
        const [rows] = await db.query(`
            SELECT t.id, t.shop_id, s.shop_name, s.village_name, t.amount, t.description, t.payment_mode, t.transaction_date, t.type, t.approval_status
            FROM shop_transactions t
            JOIN shops s ON t.shop_id = s.id
            WHERE s.shop_name = 'ALAGHUNACHI'
            ORDER BY t.transaction_date DESC
        `);
        console.log(JSON.stringify(rows, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

getShopTransactions();
