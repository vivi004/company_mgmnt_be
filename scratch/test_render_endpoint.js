const axios = require('axios');

async function testRender() {
    try {
        console.log('Sending login POST request to Render backend...');
        const res = await axios.post('https://company-mgmnt-be.onrender.com/api/auth/login', {
            username: 'Admin',
            password: 'admin'
        });
        console.log('STATUS:', res.status);
        console.log('DATA:', res.data);
    } catch (err) {
        if (err.response) {
            console.log('STATUS:', err.response.status);
            console.log('DATA:', err.response.data);
        } else {
            console.error('Error:', err.message);
        }
    }
}

testRender();
