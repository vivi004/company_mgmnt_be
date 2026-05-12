require('dotenv').config();
const db = require('./config/db');

async function fix() {
    try {
        console.log('Restoring owner_name for shops...');
        
        // Update all shops where owner_name was set to 'KOVAI PERIVU'
        // We set it back to 'SATHYAMANGALAM' as it's the 'old area name' the user refers to
        const [result] = await db.query(`
            UPDATE shops 
            SET owner_name = 'SATHYAMANGALAM' 
            WHERE owner_name = 'KOVAI PERIVU'
        `);
        
        console.log(`✅ Updated ${result.affectedRows} shops. owner_name restored to SATHYAMANGALAM.`);
        
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
fix();
