require('dotenv').config();
const db = require('../src/config/db');
const shopController = require('../src/controllers/shopController');

async function testCollectPayment() {
    const req = {
        params: { id: 122 },
        body: {
            amount: 100,
            payment_method: 'CASH',
            description: 'Test API Payment',
            collection_date: '2026-05-14'
        },
        user: { id: 1, role: 'admin' }
    };

    const res = {
        status: function(code) { this.statusCode = code; return this; },
        json: function(data) { console.log('Response:', data); }
    };

    try {
        await shopController.collectPayment(req, res);
        console.log('Payment collection finished. Checking DB...');
        
        const [collRows] = await db.query('SELECT * FROM daily_collections WHERE shop_id = 122 AND collection_date = "2026-05-14"');
        console.log("Daily Collection:", collRows);
        
        const [txs] = await db.query('SELECT * FROM shop_transactions WHERE shop_id = 122 AND DATE(transaction_date) = "2026-05-14"');
        console.log("Transactions:", txs);
        
        process.exit(0);
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
}
testCollectPayment();
