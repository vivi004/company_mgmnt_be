/**
 * Migration: Add area_name column to order_lines table.
 * 
 * The area_name is the broader area grouping (e.g., "KOVAI PERIVU")
 * that appears on invoices and loading sheets, instead of the 
 * individual village/order_line name (e.g., "SATHYAMANGALAM").
 */
require('dotenv').config();
const db = require('./config/db');

async function migrate() {
    try {
        console.log('Adding area_name column to order_lines table...');
        
        // 1. Add the column (IF NOT EXISTS not supported for columns in all MySQL versions, so use try-catch)
        try {
            await db.query(`ALTER TABLE order_lines ADD COLUMN area_name VARCHAR(255) DEFAULT NULL AFTER name`);
            console.log('✅ Column area_name added successfully.');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME') {
                console.log('ℹ️  Column area_name already exists, skipping...');
            } else {
                throw err;
            }
        }

        // 2. Backfill: Set area_name = name for all existing order lines that don't have one
        const [result] = await db.query(`UPDATE order_lines SET area_name = name WHERE area_name IS NULL OR area_name = ''`);
        console.log(`✅ Backfilled ${result.affectedRows} order lines with area_name = name.`);

        // 3. Show current state
        const [rows] = await db.query('SELECT id, name, area_name, node_id FROM order_lines ORDER BY id');
        console.log('\n📋 Current Order Lines:');
        rows.forEach(r => console.log(`  ID: ${r.id} | Name: ${r.name} | Area: ${r.area_name} | Node: ${r.node_id}`));

        console.log('\n✅ Migration complete! You can now set area_name for each order line via the Admin panel.');
        process.exit(0);
    } catch (err) {
        console.error('❌ Migration failed:', err);
        process.exit(1);
    }
}

migrate();
