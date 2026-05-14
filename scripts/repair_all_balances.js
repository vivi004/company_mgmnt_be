require('dotenv').config();
const db = require('../src/config/db');
const financialService = require('../src/services/financialService');

/**
 * REPAIR ALL BALANCES
 * This script iterates through every shop in the database and recalculates
 * their entire financial history from the very first transaction.
 * 
 * USE THIS TO FIX ANY DISCREPANCIES BETWEEN TOTAL BAL AND LEDGER.
 */
async function repairAll() {
    console.log('--- STARTING GLOBAL BALANCE REPAIR ---');
    
    try {
        // 1. Get all shops
        const [shops] = await db.query('SELECT id, shop_name FROM shops ORDER BY id ASC');
        console.log(`Found ${shops.length} shops to process.`);

        const connection = await db.getConnection();
        
        try {
            for (let i = 0; i < shops.length; i++) {
                const shop = shops[i];
                console.log(`[${i + 1}/${shops.length}] Processing: ${shop.shop_name} (ID: ${shop.id})`);
                
                await connection.beginTransaction();
                
                // Find the earliest transaction date for this shop
                const [firstTx] = await connection.query(
                    'SELECT MIN(transaction_date) as start_date FROM shop_transactions WHERE shop_id = ?',
                    [shop.id]
                );

                const startDate = firstTx[0].start_date || '2000-01-01'; // Fallback to far past
                
                // Run the master ripple from the beginning of time
                await financialService.rebuildRipple(connection, shop.id, startDate);
                
                await connection.commit();
                console.log(`Successfully repaired ${shop.shop_name}`);
            }
        } catch (err) {
            console.error('Error during shop processing:', err);
            // We don't rollback the whole thing, just the current shop failed
        } finally {
            connection.release();
        }

        console.log('--- GLOBAL REPAIR COMPLETE ---');
        process.exit(0);
    } catch (err) {
        console.error('Fatal error:', err);
        process.exit(1);
    }
}

repairAll();
