const mysql = require('mysql2/promise');
require('dotenv').config();

async function inspect() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    try {
        const shopName = 'ALAGHUNACHI';
        const date = '2026-05-14';

        console.log(`--- Inspecting Shop: ${shopName} on ${date} ---`);

        // 1. Get Shop ID
        const [shops] = await connection.query('SELECT id FROM shops WHERE shop_name = ?', [shopName]);
        if (shops.length === 0) {
            console.log('Shop not found');
            return;
        }
        const shopId = shops[0].id;
        console.log(`Shop ID: ${shopId}`);

        // 2. Get Bills for this shop on this date
        const [bills] = await connection.query(
            "SELECT id, total_amount, is_applied_to_balance FROM bills WHERE shop_id = ? AND (bill_date = ? OR delivery_date = ?)",
            [shopId, date, date]
        );
        console.log('Bills:', bills);

        // 3. Get Transactions for this shop on this date
        const [txs] = await connection.query(
            "SELECT id, type, amount, reference_id, transaction_date FROM shop_transactions WHERE shop_id = ? AND DATE(transaction_date) = ?",
            [shopId, date]
        );
        console.log('Transactions:', txs);

        // 4. Get Daily Collection row
        const [coll] = await connection.query(
            "SELECT * FROM daily_collections WHERE shop_id = ? AND collection_date = ?",
            [shopId, date]
        );
        console.log('Daily Collection Row:', coll);

    } catch (err) {
        console.error(err);
    } finally {
        await connection.end();
    }
}

inspect();
