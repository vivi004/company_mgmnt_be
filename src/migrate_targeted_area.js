/**
 * Targeted Migration: Rebrand SATHYAMANGALAM to KOVAI PERIVU.
 * 
 * This script updates any order line with the name 'SATHYAMANGALAM' 
 * (case-insensitive) to have 'KOVAI PERIVU' as its area_name.
 */
require('dotenv').config();
const db = require('./config/db');

async function migrate() {
    try {
        console.log('Searching for SATHYAMANGALAM order lines...');
        
        // 1. Find the order line
        const [rows] = await db.query("SELECT id, name, area_name FROM order_lines WHERE name LIKE '%SATHYAMANGALAM%' OR name LIKE '%SATHYAMANGLAM%'");
        
        if (rows.length === 0) {
            console.log('ℹ️  No order lines found with name SATHYAMANGALAM or SATHYAMANGLAM.');
            process.exit(0);
        }

        console.log(`Found ${rows.length} matching order lines:`);
        rows.forEach(r => console.log(`  ID: ${r.id} | Name: ${r.name} | Current Area: ${r.area_name}`));

        // 2. Update them
        const [result] = await db.query(
            "UPDATE order_lines SET area_name = 'KOVAI PERIVU' WHERE name LIKE '%SATHYAMANGALAM%' OR name LIKE '%SATHYAMANGLAM%'"
        );
        
        console.log(`\n✅ Updated ${result.affectedRows} order lines to area_name = 'KOVAI PERIVU'.`);

        // 3. Show final state
        const [finalRows] = await db.query('SELECT id, name, area_name, node_id FROM order_lines WHERE area_name = "KOVAI PERIVU"');
        console.log('\n📋 Order Lines now branded as KOVAI PERIVU:');
        finalRows.forEach(r => console.log(`  ID: ${r.id} | Name: ${r.name} | Area: ${r.area_name} | Node: ${r.node_id}`));

        console.log('\n✅ Targeted rebranding complete!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Migration failed:', err);
        process.exit(1);
    }
}

migrate();
