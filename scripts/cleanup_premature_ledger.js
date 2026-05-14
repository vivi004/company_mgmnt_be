require('dotenv').config();
const db = require('../src/config/db');
const { rebuildRipple } = require('../src/services/financialService');

async function cleanup() {
    console.log('--- STARTING LEDGER CLEANUP ---');
    try {
        // Find all shop_transactions for Bills where the underlying bill is NOT applied to balance
        const [toDelete] = await db.query(`
            SELECT st.id, st.shop_id, st.reference_id, b.delivery_date
            FROM shop_transactions st
            JOIN bills b ON st.reference_id = b.id
            WHERE st.type = 'Bill' AND b.is_applied_to_balance = 0
        `);

        if (toDelete.length === 0) {
            console.log('No premature ledger entries found.');
            process.exit(0);
        }

        console.log(`Found ${toDelete.length} premature ledger entries. Deleting...`);

        const shopsToRipple = new Set();
        for (const tx of toDelete) {
            console.log(`Deleting ledger entry ID ${tx.id} (Bill #${tx.reference_id}) for Shop #${tx.shop_id}`);
            await db.query('DELETE FROM shop_transactions WHERE id = ?', [tx.id]);
            shopsToRipple.add(tx.shop_id);
        }

        console.log('Rippling affected shops to restore balance integrity...');
        for (const shopId of shopsToRipple) {
            const connection = await db.getConnection();
            try {
                await connection.beginTransaction();
                await rebuildRipple(connection, shopId, '2000-01-01');
                await connection.commit();
                console.log(`Successfully repaired Shop #${shopId}`);
            } catch (e) {
                await connection.rollback();
                console.error(`Failed to repair Shop #${shopId}:`, e);
            } finally {
                connection.release();
            }
        }

        console.log('--- CLEANUP COMPLETE ---');
        process.exit(0);
    } catch (err) {
        console.error('Cleanup error:', err);
        process.exit(1);
    }
}

cleanup();
