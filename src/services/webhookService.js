const axios = require('axios');

exports.sendTransactionToWebhook = async (transactionData) => {
    const url = process.env.LEDGER_WEBHOOK_URL;
    if (!url) return;

    try {
        // Calculate IST manually to be 100% safe on any server (Render/Railway/etc)
        const now = new Date();
        const istOffset = 5.5 * 60 * 60 * 1000; // India is UTC + 5:30
        const istTime = new Date(now.getTime() + istOffset);
        
        // Format to a clean YYYY-MM-DD HH:mm:ss string that Sheets loves
        const istTimestamp = istTime.toISOString().replace('T', ' ').split('.')[0];
        
        const payload = {
            ...transactionData,
            payment_method: transactionData.payment_method || 'N/A',
            timestamp: istTimestamp
        };

        console.log('Pushing to Ledger (Google Sheets):', JSON.stringify(payload, null, 2));
        
        await axios.post(url, payload);
        console.log('Transaction pushed to webhook successfully');
    } catch (err) {
        console.error('CRITICAL: Failed to push transaction to ledger (Google Sheets):', err.message);
        // We do NOT throw here to prevent ledger issues from crashing the primary app
    }
};
