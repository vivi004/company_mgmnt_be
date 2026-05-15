require('dotenv').config();
const db = require('../src/config/db');

async function findAllShops() {
    try {
        const [rows] = await db.query(`
            SELECT id, shop_name, village_name, owner_name
            FROM shops
            WHERE shop_name LIKE '%ALAGHUNACHI%'
        `);
        console.log(JSON.stringify(rows, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

findAllShops();
