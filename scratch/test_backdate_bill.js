require('dotenv').config();
const db = require('../src/config/db');
const billController = require('../src/controllers/billController');

async function testCreateBill() {
    // Mock request for a backdated bill
    const req = {
        body: {
            shop_id: 122,
            cart: [{ item: 'Test', price: 100, qty: 2 }],
            custom_rates: {},
            total_amount: 200,
            bill_date: '2026-05-12' // Backdated to 12th
            // delivery_date is not provided, so it should default to bill_date
        },
        user: { id: 1, role: 'admin' }
    };

    const res = {
        status: function(code) { this.statusCode = code; return this; },
        json: function(data) { console.log('Response:', data); }
    };

    try {
        await billController.createBill(req, res);
        console.log('Bill creation finished. Checking DB...');
        
        const [collRows] = await db.query('SELECT collection_date, todays_bill_amount FROM daily_collections WHERE shop_id = 122 AND collection_date >= "2026-05-12" ORDER BY collection_date ASC');
        console.log("Daily Collections from 12th onwards:", collRows);
        
        process.exit(0);
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
}
testCreateBill();
