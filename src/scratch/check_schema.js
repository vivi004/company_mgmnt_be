const db = require('../config/db');
async function check() {
    try {
        const [rows] = await db.query('DESCRIBE shops');
        console.log(JSON.stringify(rows, null, 2));
    } catch (e) {
        console.error(e);
    }
    process.exit();
}
check();
