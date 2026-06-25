const axios = require('axios');
const db = require('../config/db');

/**
 * Send push notification to a list of tokens via Expo Push API
 */
async function sendExpoPushNotification(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return;
    
    try {
        console.log(`[PUSH] Sending ${messages.length} notifications via Expo...`);
        const response = await axios.post('https://exp.host/--/api/v2/push/send', messages, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip, deflate',
            }
        });
        
        const responseData = response.data;
        if (responseData && responseData.data) {
            responseData.data.forEach((ticket, index) => {
                if (ticket.status === 'error') {
                    console.error(`[PUSH ERROR] Token: ${messages[index].to} - Error: ${ticket.message}`);
                } else {
                    console.log(`[PUSH SUCCESS] Sent to: ${messages[index].to}`);
                }
            });
        }
    } catch (err) {
        console.error('[PUSH ERROR] Failed to send push notification to Expo API:', err.message);
        if (err.response && err.response.data) {
            console.error('[PUSH ERROR DETAILED]', JSON.stringify(err.response.data));
        }
    }
}

/**
 * Send push notification to a specific employee ID
 */
async function sendPushToUser(employeeId, title, body, data = {}) {
    try {
        const [rows] = await db.query(
            'SELECT expo_push_token FROM employees WHERE id = ? AND status = "Active"',
            [employeeId]
        );
        
        if (rows.length === 0 || !rows[0].expo_push_token) {
            console.log(`[PUSH] Skip sending to employee ${employeeId}: No active device or token unregistered.`);
            return;
        }
        
        const token = rows[0].expo_push_token;
        const message = {
            to: token,
            sound: 'default',
            title,
            body,
            data
        };
        
        await sendExpoPushNotification([message]);
    } catch (err) {
        console.error(`[PUSH ERROR] Failed to query token for employee ${employeeId}:`, err.message);
    }
}

/**
 * Send push notification to a user by matching their Full Name (TRIM & LOWER comparison)
 * Useful for created_by strings.
 */
async function sendPushToUserByName(fullName, title, body, data = {}) {
    if (!fullName) return;
    try {
        const [rows] = await db.query(
            `SELECT id, expo_push_token 
             FROM employees 
             WHERE TRIM(LOWER(CONCAT(first_name, ' ', COALESCE(last_name, '')))) = TRIM(LOWER(?)) 
             AND status = "Active"`,
            [fullName]
        );
        
        if (rows.length === 0 || !rows[0].expo_push_token) {
            console.log(`[PUSH] Skip sending to user '${fullName}': No active token found.`);
            return;
        }
        
        const token = rows[0].expo_push_token;
        const message = {
            to: token,
            sound: 'default',
            title,
            body,
            data
        };
        
        await sendExpoPushNotification([message]);
    } catch (err) {
        console.error(`[PUSH ERROR] Failed to query token by name '${fullName}':`, err.message);
    }
}

/**
 * Send push notification to all active Admins
 */
async function sendPushToAdmins(title, body, data = {}) {
    try {
        const [rows] = await db.query(
            'SELECT expo_push_token FROM employees WHERE LOWER(role) = "admin" AND status = "Active" AND expo_push_token IS NOT NULL'
        );
        
        const messages = rows
            .map(row => row.expo_push_token)
            .filter(Boolean)
            .map(token => ({
                to: token,
                sound: 'default',
                title,
                body,
                data
            }));
            
        if (messages.length === 0) {
            console.log('[PUSH] Skip sending to admins: No active admins with push tokens.');
            return;
        }
        
        await sendExpoPushNotification(messages);
    } catch (err) {
        console.error('[PUSH ERROR] Failed to query admin tokens:', err.message);
    }
}

module.exports = {
    sendPushToUser,
    sendPushToUserByName,
    sendPushToAdmins,
    sendExpoPushNotification
};
