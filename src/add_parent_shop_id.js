const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT || 3306,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        console.log("Connected to database. Altering shops table...");
        
        // 1. Add parent_shop_id column
        await connection.query(`
            ALTER TABLE shops ADD COLUMN parent_shop_id INT NULL DEFAULT NULL
        `);
        console.log("Column parent_shop_id added successfully.");

        // 2. Add foreign key constraint
        await connection.query(`
            ALTER TABLE shops 
            ADD CONSTRAINT fk_parent_shop 
            FOREIGN KEY (parent_shop_id) 
            REFERENCES shops(id) 
            ON DELETE SET NULL
        `);
        console.log("Foreign key constraint fk_parent_shop added successfully.");

        console.log("Database schema migration completed successfully!");
        process.exit(0);
    } catch (err) {
        console.error("Migration failed:", err.message);
        process.exit(1);
    }
}

run();
