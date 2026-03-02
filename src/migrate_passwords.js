/**
 * Password Migration Script
 * Run this ONCE to hash all existing plain-text passwords in the DB.
 * Usage: node src/migrate_passwords.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

async function migrate() {
    const db = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    console.log('Connected to database. Fetching employees...');
    const [employees] = await db.execute('SELECT id, username, password FROM employees');

    console.log(`Found ${employees.length} employees to migrate.`);

    let migrated = 0;
    let skipped = 0;

    for (const emp of employees) {
        // Check if already hashed (bcrypt hashes start with $2b$)
        if (emp.password && emp.password.startsWith('$2b$')) {
            console.log(`  [SKIP] Employee ID ${emp.id} (${emp.username}) — already hashed`);
            skipped++;
            continue;
        }

        if (!emp.password) {
            console.log(`  [SKIP] Employee ID ${emp.id} (${emp.username}) — empty password`);
            skipped++;
            continue;
        }

        const hashed = await bcrypt.hash(emp.password, SALT_ROUNDS);
        await db.execute('UPDATE employees SET password = ? WHERE id = ?', [hashed, emp.id]);
        console.log(`  [OK]   Employee ID ${emp.id} (${emp.username}) — password hashed`);
        migrated++;
    }

    await db.end();
    console.log(`\n✅ Migration complete: ${migrated} hashed, ${skipped} skipped.`);
    console.log('You can now delete this script.');
}

migrate().catch(err => {
    console.error('Migration failed:', err.message);
    process.exit(1);
});
