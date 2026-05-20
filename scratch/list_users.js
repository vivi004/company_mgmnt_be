const mysql = require('mysql2/promise');

async function listUsers() {
    const db = await mysql.createConnection({
        host: 'shuttle.proxy.rlwy.net',
        port: 15638,
        user: 'root',
        password: 'JvsyikEPpmGPPyMTsnhhFbqsejWVmpXQ',
        database: 'railway'
    });

    console.log('Connected! Fetching usernames and roles...');
    const [rows] = await db.execute('SELECT username, role, first_name, last_name, status FROM employees');
    console.log('--- USER DATA ---');
    console.log(JSON.stringify(rows, null, 2));
    await db.end();
}

listUsers().catch(err => {
    console.error('Error fetching users:', err);
});
