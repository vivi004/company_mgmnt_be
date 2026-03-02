const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function run() {
    try {
        console.log(`Connecting to ${process.env.DB_NAME} on ${process.env.DB_HOST}...`);
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        console.log("Connected. Finding foreign keys referencing 'employees' table...");
        const [rows] = await connection.query(`
            SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE REFERENCED_TABLE_SCHEMA = ?
              AND REFERENCED_TABLE_NAME = 'employees';
        `, [process.env.DB_NAME]);

        console.log(`Found ${rows.length} foreign keys.`);

        for (const row of rows) {
            const tableName = row.TABLE_NAME;
            const fkName = row.CONSTRAINT_NAME;
            const colName = row.COLUMN_NAME;
            const refColName = row.REFERENCED_COLUMN_NAME;

            console.log(`Dropping and recreating constraint ${fkName} on ${tableName}(${colName}) -> employees(${refColName})`);

            await connection.query(`ALTER TABLE \`${tableName}\` DROP FOREIGN KEY \`${fkName}\``);
            await connection.query(`
                ALTER TABLE \`${tableName}\`
                ADD CONSTRAINT \`${fkName}\`
                FOREIGN KEY (\`${colName}\`) REFERENCES \`employees\` (\`${refColName}\`) ON DELETE CASCADE
            `);
            console.log("Done.");
        }

        console.log("All foreign keys updated successfully!");
        process.exit(0);
    } catch (err) {
        console.error("Error:", err.message);
        process.exit(1);
    }
}

run();
