require('dotenv').config();
const db = require('../src/config/db');

async function run() {
    try {
        const shopId = 122;
        console.log("Cleaning Alaghunachi (122)...");
        
        // 1. Remove the bad 11th record
        await db.query("DELETE FROM daily_collections WHERE shop_id = ? AND collection_date = '2026-05-11'", [shopId]);
        
        // 2. Fix 12th
        await db.query(`
            UPDATE daily_collections 
            SET old_balance = 0, todays_bill_amount = 2000, total_balance = 2000 
            WHERE shop_id = ? AND collection_date = '2026-05-12'
        `, [shopId]);

        // 3. Fix 13th
        await db.query(`
            UPDATE daily_collections 
            SET old_balance = 2000, todays_bill_amount = 2000, total_balance = 4000 
            WHERE shop_id = ? AND collection_date = '2026-05-13'
        `, [shopId]);

        // 4. Update shop balance to match
        await db.query("UPDATE shop_balances SET balance = 4000 WHERE shop_id = ?", [shopId]);

        console.log("Success! Alaghunachi is now balanced.");
    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}
run();
