require('dotenv').config();
const db = require('../src/config/db');
const billController = require('../src/controllers/billController');

async function testTodayBill() {
    // Get today's IST date string
    const now = new Date();
    const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    const today = ist.toISOString().split('T')[0];

    const req = {
        body: {
            shop_id: 122,
            total_amount: 1000,
            delivery_date: today, // Today
            cart: [],
            created_by: 'TestScript'
        }
    };
    const res = {
        status: function(s) { this.statusCode = s; return this; },
        json: function(j) { this.data = j; console.log('Response:', JSON.stringify(j, null, 2)); }
    };

    try {
        await billController.createBill(req, res);
        
        // Now check if it's in shop_transactions
        const [txs] = await db.query('SELECT * FROM shop_transactions WHERE reference_id = ?', [res.data.id]);
        console.log('Ledger entries for new bill:', txs.length);
        
        const [bills] = await db.query('SELECT is_applied_to_balance FROM bills WHERE id = ?', [res.data.id]);
        console.log('Bill applied status:', bills[0].is_applied_to_balance);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
testTodayBill();
