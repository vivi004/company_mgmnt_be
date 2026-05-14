require('dotenv').config();
const db = require('../src/config/db');
const billController = require('../src/controllers/billController');

async function testFutureBill() {
    const req = {
        body: {
            shop_id: 122,
            total_amount: 500,
            delivery_date: '2026-05-16', // Future date
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
testFutureBill();
