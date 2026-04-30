const axios = require('axios');

exports.sendTransactionToWebhook = async (transactionData) => {
    const url = process.env.LEDGER_WEBHOOK_URL;
    if (!url) return;

    try {
        await axios.post(url, {
            ...transactionData,
            timestamp: new Date().toISOString()
        });
        console.log('Transaction pushed to webhook successfully');
    } catch (err) {
        console.error('Failed to push transaction to webhook:', err.message);
        throw new Error(`Webhook push failed: ${err.message}`);
    }
};
