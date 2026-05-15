require('dotenv').config();
const db = require('../src/config/db');

async function getShopBalance() {
    try {
        const [rows] = await db.query(`
            SELECT s.id, s.shop_name, sb.balance
            FROM shops s
            JOIN shop_balances sb ON s.id = sb.shop_id
            WHERE s.shop_name = 'ALAGHUNACHI'
        `);
        console.log(JSON.stringify(rows, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

getShopBalance();
