const mysql = require('mysql2/promise');
require('dotenv').config();

async function migrate() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    try {
        console.log('Starting Shop Balance Migration...');

        // 1. Create shop_balances table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS shop_balances (
                shop_id INT PRIMARY KEY,
                balance DECIMAL(12, 2) DEFAULT 0.00,
                opening_balance DECIMAL(12, 2) DEFAULT 0.00,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
            )
        `);
        console.log('✔ Table shop_balances created or already exists.');

        // 2. Fetch existing shops with balances
        const [shops] = await connection.query('SELECT id, balance FROM shops');
        console.log(`✔ Found ${shops.length} shops to migrate.`);

        // 3. Migrate data
        for (const shop of shops) {
            await connection.query(
                'INSERT INTO shop_balances (shop_id, balance, opening_balance) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE balance = VALUES(balance)',
                [shop.id, shop.balance, shop.balance]
            );
        }
        console.log('✔ Data migration complete.');

        console.log('Migration finished successfully!');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await connection.end();
    }
}

migrate();
