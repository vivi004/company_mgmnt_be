require('dotenv').config();
const mysql = require('mysql2/promise');

async function debug() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT || 3306
    });

    try {
        console.log("Searching for AYYA STORE (KANNAMOOCHI)...");
        const [shops] = await connection.query("SELECT id, shop_name, village_name FROM shops WHERE shop_name LIKE '%AYYA STORE%'");
        console.log("Shops found:", JSON.stringify(shops, null, 2));

        for (const shop of shops) {
            console.log(`\n======================= SHOP: ${shop.shop_name} (ID: ${shop.id}) =======================`);
            
            const [balance] = await connection.query("SELECT * FROM shop_balances WHERE shop_id = ?", [shop.id]);
            console.log("shop_balances:", JSON.stringify(balance, null, 2));

            const [collections] = await connection.query("SELECT * FROM daily_collections WHERE shop_id = ? ORDER BY collection_date DESC LIMIT 5", [shop.id]);
            console.log("daily_collections:", JSON.stringify(collections, null, 2));

            const [bills] = await connection.query("SELECT id, invoice_no, total_amount, bill_date, delivery_date, status, is_applied_to_balance FROM bills WHERE shop_id = ? ORDER BY id DESC LIMIT 5", [shop.id]);
            console.log("Recent bills:", JSON.stringify(bills, null, 2));

            const [txs] = await connection.query("SELECT id, type, amount, transaction_date, approval_status, reference_id FROM shop_transactions WHERE shop_id = ? ORDER BY transaction_date DESC, id DESC LIMIT 5", [shop.id]);
            console.log("Recent transactions:", JSON.stringify(txs, null, 2));
        }
    } catch (err) {
        console.error(err);
    } finally {
        await connection.end();
    }
}

debug();
