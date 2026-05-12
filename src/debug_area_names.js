require('dotenv').config();
const db = require('./config/db');

async function check() {
    try {
        // Check for any shops with 'KOVAI PERIVU' in village_name
        const [rows] = await db.query(`
            SELECT s.id, s.shop_name, s.village_name, s.order_line_id, ol.name as ol_name, ol.area_name as ol_area
            FROM shops s 
            JOIN order_lines ol ON s.order_line_id = ol.id 
            WHERE s.village_name = 'KOVAI PERIVU'
        `);
        console.log('Shops with village_name = KOVAI PERIVU:');
        console.log(rows);

        // Check for any order lines with 'KOVAI PERIVU' in area_name
        const [ols] = await db.query(`SELECT id, name, area_name FROM order_lines`);
        console.log('\nAll Order Lines:');
        console.log(ols);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
check();
