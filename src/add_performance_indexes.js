/**
 * Migration: Add performance indexes for high-volume data.
 * Run this ONCE to make queries fast at 200K+ bills.
 * Safe to run multiple times (uses IF NOT EXISTS via try/catch).
 */
require('dotenv').config();
const db = require('./config/db');

const indexes = [
    // bills table — most critical
    { table: 'bills', name: 'idx_bills_status',         sql: 'ALTER TABLE bills ADD INDEX idx_bills_status (status)' },
    { table: 'bills', name: 'idx_bills_shop_id',        sql: 'ALTER TABLE bills ADD INDEX idx_bills_shop_id (shop_id)' },
    { table: 'bills', name: 'idx_bills_delivery_date',  sql: 'ALTER TABLE bills ADD INDEX idx_bills_delivery_date (delivery_date)' },
    { table: 'bills', name: 'idx_bills_bill_date',      sql: 'ALTER TABLE bills ADD INDEX idx_bills_bill_date (bill_date)' },
    { table: 'bills', name: 'idx_bills_applied',        sql: 'ALTER TABLE bills ADD INDEX idx_bills_applied (shop_id, is_applied_to_balance)' },
    { table: 'bills', name: 'idx_bills_shop_created',   sql: 'ALTER TABLE bills ADD INDEX idx_bills_shop_created (shop_id, created_at)' },

    // shop_transactions table
    { table: 'shop_transactions', name: 'idx_tx_shop_date',    sql: 'ALTER TABLE shop_transactions ADD INDEX idx_tx_shop_date (shop_id, transaction_date)' },
    { table: 'shop_transactions', name: 'idx_tx_approval',     sql: 'ALTER TABLE shop_transactions ADD INDEX idx_tx_approval (approval_status)' },
    { table: 'shop_transactions', name: 'idx_tx_shop_type',    sql: 'ALTER TABLE shop_transactions ADD INDEX idx_tx_shop_type (shop_id, type)' },

    // daily_collections table
    { table: 'daily_collections', name: 'idx_dc_shop_date',    sql: 'ALTER TABLE daily_collections ADD INDEX idx_dc_shop_date (shop_id, collection_date)' },
    { table: 'daily_collections', name: 'idx_dc_ol_date',      sql: 'ALTER TABLE daily_collections ADD INDEX idx_dc_ol_date (order_line_id, collection_date)' },

    // shops table
    { table: 'shops', name: 'idx_shops_ol',             sql: 'ALTER TABLE shops ADD INDEX idx_shops_ol (order_line_id)' },
    { table: 'shops', name: 'idx_shops_name',           sql: 'ALTER TABLE shops ADD INDEX idx_shops_name (shop_name, village_name)' },
];

async function migrate() {
    let added = 0;
    let skipped = 0;

    for (const idx of indexes) {
        try {
            await db.query(idx.sql);
            console.log(`✅ Added index: ${idx.name} on ${idx.table}`);
            added++;
        } catch (e) {
            if (e.code === 'ER_DUP_KEYNAME') {
                console.log(`⏭️  Already exists: ${idx.name}`);
                skipped++;
            } else {
                console.error(`❌ Failed: ${idx.name} — ${e.message}`);
            }
        }
    }

    console.log(`\nDone. Added: ${added}, Skipped: ${skipped}`);
    process.exit(0);
}

migrate();
