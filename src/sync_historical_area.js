require('dotenv').config();
const db = require('./config/db');

async function check() {
    try {
        const [shops] = await db.query("SELECT id, shop_name, village_name FROM shops WHERE village_name LIKE '%SATHYAMANG%' OR village_name LIKE '%SATHYAMANGL%'");
        const [bills] = await db.query("SELECT id, village_name FROM bills WHERE village_name LIKE '%SATHYAMANG%' OR village_name LIKE '%SATHYAMANGL%'");
        
        console.log('--- SHOPS ---');
        console.log(shops);
        console.log('--- BILLS COUNT ---');
        console.log(bills.length);
        
        if (shops.length > 0) {
            console.log('\nUpdating shops...');
            await db.query("UPDATE shops SET village_name = 'KOVAI PERIVU' WHERE village_name LIKE '%SATHYAMANG%' OR village_name LIKE '%SATHYAMANGL%'");
        }
        
        if (bills.length > 0) {
            console.log('Updating bills...');
            await db.query("UPDATE bills SET village_name = 'KOVAI PERIVU' WHERE village_name LIKE '%SATHYAMANG%' OR village_name LIKE '%SATHYAMANGL%'");
        }
        
        console.log('\nSync complete!');
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
check();
