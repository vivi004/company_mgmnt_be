const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

async function testLocalLogin() {
    const db = await mysql.createConnection({
        host: 'shuttle.proxy.rlwy.net',
        port: 15638,
        user: 'root',
        password: 'JvsyikEPpmGPPyMTsnhhFbqsejWVmpXQ',
        database: 'railway'
    });

    const username = 'Admin';
    const password = 'admin';

    console.log('Querying employee database...');
    const [rows] = await db.execute(
        'SELECT * FROM employees WHERE username = ? AND status = "Active"',
        [username]
    );

    if (rows.length === 0) {
        console.log('User not found or inactive.');
        await db.end();
        return;
    }

    const user = rows[0];
    console.log('Found user:', user.username);
    console.log('Comparing passwords...');
    const isMatch = await bcrypt.compare(password, user.password);
    console.log('Password match status:', isMatch);

    if (!isMatch) {
        console.log('Password does not match.');
        await db.end();
        return;
    }

    console.log('Signing JWT Token...');
    try {
        const token = jwt.sign(
            { id: user.id, role: user.role.toLowerCase() },
            'NishaCompanyMgmt_SuperSecret_2026_ChangeInProduction',
            { expiresIn: '7d' }
        );
        console.log('JWT Token successfully generated:', token.slice(0, 30) + '...');
    } catch (jwtErr) {
        console.error('JWT Sign Error:', jwtErr);
    }

    await db.end();
}

testLocalLogin().catch(console.error);
