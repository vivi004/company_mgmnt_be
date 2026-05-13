require('dotenv').config();
const db = require('../src/config/db');

async function run() {
    try {
        console.log("Cleaning up phantom records with no history...");
        
        // Find all records that have 0 activity
        const [rows] = await db.query(`
            SELECT id, shop_id, collection_date, old_balance, total_balance 
            FROM daily_collections 
            WHERE todays_bill_amount = 0 
              AND cash_collected = 0 
              AND upi_collected = 0 
              AND cheque_collected = 0 
              AND manual_adjustments = 0 
              AND future_bills = 0
        `);

        for (const row of rows) {
            // Check if there is ANY record before this one for this shop
            const [prev] = await db.query(
                "SELECT id FROM daily_collections WHERE shop_id = ? AND collection_date < ? LIMIT 1",
                [row.shop_id, row.collection_date]
            );

            // If there's no history before this date, and this date has no activity, 
            // but it has a non-zero balance... it's a phantom. Delete it.
            if (prev.length === 0 && (parseFloat(row.old_balance) !== 0 || parseFloat(row.total_balance) !== 0)) {
                await db.query("DELETE FROM daily_collections WHERE id = ?", [row.id]);
                console.log(`Deleted phantom record ID ${row.id} for Shop ${row.shop_id} on ${row.collection_date.toISOString().split('T')[0]}`);
            }
        }

        console.log("Cleanup Complete!");
    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}
run();
