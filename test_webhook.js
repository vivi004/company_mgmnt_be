const axios = require('axios');
require('dotenv').config();

const url = 'https://script.google.com/macros/s/AKfycbxDVzYOKV6gBYxgIdkcu5dQJYZ6RtBio5oFsVjMEW9xqkAUjoSZqnQbgdIbCi5In5lc/exec';

const data = {
    shop_id: 0,
    shop_name: "TEST SHOP",
    village_name: "TEST VILLAGE",
    type: "TEST",
    amount: 100,
    description: "Testing Webhook Connection",
    balance_after: 100,
    created_by: "Debugger",
    timestamp: new Date().toISOString()
};

async function test() {
    console.log('Sending test data to:', url);
    try {
        const response = await axios.post(url, data);
        console.log('Response Status:', response.status);
        console.log('Response Data:', response.data);
    } catch (err) {
        console.error('Error:', err.message);
        if (err.response) {
            console.error('Response details:', err.response.data);
        }
    }
}

test();
