require('dotenv').config();
const db = require('../src/config/db');

async function run() {
    try {
        console.log("--- SEARCHING FOR SHOP ---");
        const [shops] = await db.query("SELECT id, shop_name FROM shops WHERE shop_name LIKE '%ALAGHUNACHI%' LIMIT 1");
        
        if (shops.length > 0) {
            const shop = shops[0];
            console.log(`Found Shop: ${shop.shop_name} (ID: ${shop.id})`);
            
            console.log("--- COLLECTION RECORDS ---");
            const [rows] = await db.query("SELECT * FROM daily_collections WHERE shop_id = ? ORDER BY collection_date ASC", [shop.id]);
            console.table(rows.map(r => ({
                date: r.collection_date.toISOString().split('T')[0],
                prev: r.old_balance,
                bill: r.todays_bill_amount,
                coll: r.cash_collected + r.upi_collected + r.cheque_collected,
                total: r.total_balance
            })));

            console.log("--- BILLS ---");
            const [bills] = await db.query("SELECT id, total_amount, delivery_date FROM bills WHERE shop_id = ?", [shop.id]);
            console.table(bills.map(b => ({
                id: b.id,
                amt: b.total_amount,
                delivery: b.delivery_date
            })));
        } else {
            console.log("Shop ALAGHUNACHI not found.");
        }
    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

run();
