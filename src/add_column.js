const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        console.log("Connected. Altering table...");
        const [result] = await connection.query(`
            ALTER TABLE employees ADD COLUMN accessible_orderlines JSON DEFAULT NULL
        `);
        console.log("Success!", result);
        process.exit(0);
    } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
    }
}

run();
