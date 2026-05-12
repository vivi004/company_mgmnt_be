require('dotenv').config();
const db = require('./config/db');

async function restore() {
    try {
        console.log('Restoring village names for ID 36...');
        
        // 1. Update Order Line 36: Restore original village name, keep area name as KOVAI PERIVU
        await db.query("UPDATE order_lines SET name = 'SATHYAMANGALAM', area_name = 'KOVAI PERIVU' WHERE id = 36");
        console.log('✅ Order line 36 restored to name=SATHYAMANGALAM, area_name=KOVAI PERIVU');

        // 2. Update Shops linked to ID 36: Restore village name
        const [shopResult] = await db.query("UPDATE shops SET village_name = 'SATHYAMANGALAM' WHERE order_line_id = 36");
        console.log(`✅ Restored village_name to SATHYAMANGALAM for ${shopResult.affectedRows} shops.`);

        // 3. Update Bills for those shops: Restore village name
        const [billResult] = await db.query("UPDATE bills SET village_name = 'SATHYAMANGALAM' WHERE shop_id IN (SELECT id FROM shops WHERE order_line_id = 36)");
        console.log(`✅ Restored village_name to SATHYAMANGALAM for ${billResult.affectedRows} bills.`);

        // 4. Verification
        const [rows] = await db.query("SELECT id, name, area_name, node_id FROM order_lines WHERE id = 36");
        console.log('\n📋 Current state for ID 36:');
        console.log(rows);

        console.log('\n✅ Restore complete. Village names are back to SATHYAMANGALAM, but Area name remains KOVAI PERIVU for display.');
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
restore();
