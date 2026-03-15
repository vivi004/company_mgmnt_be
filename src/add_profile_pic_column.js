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

        console.log("Connected. Altering table employees to add profile_pic...");
        // LONGTEXT is used to store base64 strings of images
        const [result] = await connection.query(`
            ALTER TABLE employees ADD COLUMN profile_pic LONGTEXT DEFAULT NULL
        `);
        console.log("Success!", result);
        process.exit(0);
    } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
    }
}

run();
