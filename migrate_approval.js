require('dotenv').config();
const pool = require('./src/config/db');

async function migrate() {
    try {
        console.log('--- STARTING PAYMENT APPROVAL MIGRATION ---');

        // 1. Add new columns to shop_transactions
        await pool.query(`
            ALTER TABLE shop_transactions
            ADD COLUMN approval_status ENUM('PENDING', 'APPROVED', 'REJECTED') DEFAULT 'APPROVED',
            ADD COLUMN affects_balance BOOLEAN DEFAULT TRUE,
            ADD COLUMN approved_by VARCHAR(255) DEFAULT NULL,
            ADD COLUMN approved_at DATETIME DEFAULT NULL,
            ADD COLUMN rejected_reason TEXT DEFAULT NULL,
            ADD COLUMN transaction_category ENUM('BILL', 'PAYMENT', 'MANUAL_ADJUST') DEFAULT 'PAYMENT',
            ADD COLUMN payment_mode VARCHAR(50) DEFAULT NULL;
        `);
        console.log('Columns added to shop_transactions.');

        // 2. Backfill existing data
        // For old data, we assume everything was APPROVED and affected balance
        // We can guess the category and mode from descriptions
        await pool.query(`
            UPDATE shop_transactions 
            SET approval_status = 'APPROVED', 
                affects_balance = TRUE,
                transaction_category = CASE 
                    WHEN type = 'Bill' THEN 'BILL'
                    WHEN type = 'Payment' THEN 'PAYMENT'
                    ELSE 'MANUAL_ADJUST'
                END,
                payment_mode = CASE 
                    WHEN description LIKE '%Cash%' THEN 'CASH'
                    WHEN description LIKE '%UPI%' THEN 'UPI'
                    WHEN description LIKE '%PhonePe%' THEN 'UPI'
                    WHEN description LIKE '%GPay%' THEN 'UPI'
                    WHEN description LIKE '%Paytm%' THEN 'UPI'
                    WHEN description LIKE '%Cheque%' THEN 'CHEQUE'
                    ELSE 'CASH'
                END;
        `);
        console.log('Existing transactions backfilled.');

        console.log('--- MIGRATION COMPLETED SUCCESSFULLY ---');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
