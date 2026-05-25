require('dotenv').config();
const db = require('../src/config/db');
const { rebuildRipple } = require('../src/services/financialService');

async function migrate() {
    console.log('--- STARTING OPENING BALANCE MIGRATION ---');
    const connection = await db.getConnection();
    
    try {
        // 1. Get all shops with opening_balance > 0
        const [shops] = await connection.query(`
            SELECT sb.shop_id, s.shop_name, sb.opening_balance, s.created_at, s.order_line_id
            FROM shop_balances sb
            JOIN shops s ON sb.shop_id = s.id
            WHERE sb.opening_balance > 0
        `);

        console.log(`Found ${shops.length} shops with opening_balance > 0 to migrate.`);

        for (let i = 0; i < shops.length; i++) {
            const shop = shops[i];
            const shopId = shop.shop_id;
            const openBal = parseFloat(shop.opening_balance);
            const createdAt = shop.created_at;
            
            console.log(`\n[${i + 1}/${shops.length}] Migrating Shop: ${shop.shop_name} (ID: ${shopId}, Opening Balance: ${openBal})`);

            await connection.beginTransaction();

            // Check if there is already a transaction representing this balance
            const [existingTx] = await connection.query(
                `SELECT id, description, amount, transaction_date 
                 FROM shop_transactions 
                 WHERE shop_id = ? 
                   AND (ABS(amount - ?) < 0.01 OR description LIKE '%OLD BAL%' OR description LIKE '%Opening%' OR description LIKE '%Shop Registered%')
                   AND approval_status = 'APPROVED'`,
                [shopId, openBal]
            );

            if (existingTx.length > 0) {
                console.log(`-> Found existing transaction representing opening balance (ID: ${existingTx[0].id}, Desc: "${existingTx[0].description}", Amt: ${existingTx[0].amount})`);
                console.log(`-> Setting opening_balance to 0 in shop_balances...`);
                await connection.query(
                    'UPDATE shop_balances SET opening_balance = 0 WHERE shop_id = ?',
                    [shopId]
                );
            } else {
                console.log(`-> No existing transaction found. Creating new 'Shop Registered (Opening Balance)' transaction...`);
                
                // Construct the mysqlDate (creation date in local time)
                const toISTDate = (date) => {
                    const d = typeof date === 'string' ? new Date(date) : date;
                    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
                };
                const istNow = new Date(createdAt.getTime() + 5.5 * 60 * 60 * 1000);
                const currentISTTime = istNow.toISOString().slice(11, 19); // HH:MM:SS in IST
                const mysqlDate = `${toISTDate(createdAt)} ${currentISTTime}`;

                // Insert the Registration transaction
                await connection.query(
                    `INSERT INTO shop_transactions 
                        (shop_id, type, amount, description, balance_after, approval_status, affects_balance, created_by, transaction_date, transaction_category, payment_mode) 
                     VALUES (?, 'Adjustment', ?, 'Shop Registered (Opening Balance)', ?, 'APPROVED', TRUE, 'System', ?, 'MANUAL_ADJUST', 'CASH')`,
                    [shopId, openBal, openBal, mysqlDate]
                );

                console.log(`-> Setting opening_balance to 0 in shop_balances...`);
                await connection.query(
                    'UPDATE shop_balances SET opening_balance = 0 WHERE shop_id = ?',
                    [shopId]
                );
            }

            // Run the rebuild ripple starting from the beginning of time
            console.log(`-> Running master rebuildRipple starting from 2000-01-01...`);
            await rebuildRipple(connection, shopId, '2000-01-01');

            await connection.commit();
            console.log(`Successfully migrated ${shop.shop_name}`);
        }

        console.log('\n--- OPENING BALANCE MIGRATION COMPLETE ---');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        if (connection) await connection.rollback();
        process.exit(1);
    } finally {
        if (connection) connection.release();
    }
}

migrate();
