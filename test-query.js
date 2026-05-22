require('dotenv').config();
const db = require('./src/config/db');

async function test() {
    try {
        console.log('Testing shop_transactions query...');
        // Let's first test a simple select from shop_transactions to see its column names
        const [columns] = await db.query(`DESCRIBE shop_transactions`);
        console.log('shop_transactions columns:', columns.map(c => c.Field));

        const [returnsColumns] = await db.query(`DESCRIBE product_returns`);
        console.log('product_returns columns:', returnsColumns.map(c => c.Field));

        // Now run the query used in getShopDayDetails with dummy arguments
        console.log('Running getShopDayDetails query...');
        const shopId = 1;
        const date = '2026-05-22';
        const [transactions] = await db.query(`
            SELECT id, type, amount, payment_mode, transaction_category, description, transaction_date, created_by
            FROM shop_transactions
            WHERE shop_id = ? AND approval_status = 'APPROVED'
              AND transaction_date >= ? AND transaction_date < DATE_ADD(?, INTERVAL 1 DAY)
            ORDER BY transaction_date ASC, id ASC
        `, [shopId, date, date]);
        console.log('Query success! Transactions count:', transactions.length);
    } catch (err) {
        console.error('QUERY ERROR:', err);
    } finally {
        process.exit();
    }
}

test();
