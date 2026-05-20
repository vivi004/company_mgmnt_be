const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function testPassword() {
    const db = await mysql.createConnection({
        host: 'shuttle.proxy.rlwy.net',
        port: 15638,
        user: 'root',
        password: 'JvsyikEPpmGPPyMTsnhhFbqsejWVmpXQ',
        database: 'railway'
    });

    const [rows] = await db.execute('SELECT username, password FROM employees WHERE username = "Admin"');
    if (rows.length === 0) {
        console.log('No Admin user found.');
        await db.end();
        return;
    }

    const hash = rows[0].password;
    console.log('Hashed Password in DB:', hash);

    const candidates = ['admin', 'Admin', 'Admin@123', 'admin@123', 'Admin123', 'admin123', '123456', '12345678', 'nisha', 'Nisha', 'nisha123', 'Nisha123', 'Nisha@123', 'nisha@123'];
    for (const cand of candidates) {
        const match = await bcrypt.compare(cand, hash);
        if (match) {
            console.log(`FOUND MATCH! The password is: "${cand}"`);
            await db.end();
            return;
        }
    }
    console.log('No matches found in the common passwords list.');
    await db.end();
}

testPassword().catch(console.error);
