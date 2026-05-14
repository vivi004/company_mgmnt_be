require('dotenv').config();
const db = require('../src/config/db');
const { rebuildRipple } = require('../src/services/financialService');

async function testTransaction() {
    const shopId = 122; // ALAGHUNACHI
    const payAmount = 500;
    const targetDate = '2026-05-14';

    const istNow = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
    const currentISTTime = istNow.toISOString().slice(11, 19);
    const mysqlDate = `${targetDate} ${currentISTTime}`;

    console.log('Inserting transaction at:', mysqlDate);

    try {
        const [shopRows] = await db.query('SELECT balance FROM shop_balances WHERE shop_id = ?', [shopId]);
        const currentBalance = parseFloat(shopRows[0].balance);
        const newBalance = currentBalance - payAmount;

        await db.query('UPDATE shop_balances SET balance = ? WHERE shop_id = ?', [newBalance, shopId]);

        await db.query(
            `INSERT INTO shop_transactions 
                (shop_id, type, amount, payment_mode, transaction_category, description, 
                 balance_after, approval_status, affects_balance, created_by, transaction_date) 
             VALUES (?, 'Payment', ?, ?, 'PAYMENT', ?, ?, ?, ?, ?, ?)`,
            [shopId, payAmount, 'CASH', 'Test Payment', newBalance, 'APPROVED', 1, 'Agent', mysqlDate]
        );

        console.log('Transaction inserted. Running ripple...');
        await rebuildRipple(await db.getConnection(), shopId, targetDate);

        console.log('Ripple finished. Checking daily_collections...');
        const [collRows] = await db.query('SELECT * FROM daily_collections WHERE shop_id = ? AND collection_date = ?', [shopId, targetDate]);
        console.log(collRows[0]);
        process.exit(0);
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
}
testTransaction();
