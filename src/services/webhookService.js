const axios = require('axios');
const db = require('../config/db');

/**
 * Format Date object to IST YYYY-MM-DD HH:mm:ss string
 */
function formatIST(dateObj) {
    const istTime = new Date(dateObj.getTime() + (5.5 * 60 * 60 * 1000));
    const yyyy = istTime.getUTCFullYear();
    const mm = String(istTime.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(istTime.getUTCDate()).padStart(2, '0');
    const hh = String(istTime.getUTCHours()).padStart(2, '0');
    const min = String(istTime.getUTCMinutes()).padStart(2, '0');
    const ss = String(istTime.getUTCSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}+05:30`;
}

/**
 * Helper to scan database for the latest matching transaction row.
 * Returns transaction ID if found, otherwise null.
 */
async function findTransactionId(transactionData) {
    if (!transactionData || Array.isArray(transactionData)) return null;
    try {
        // If reference_id is provided, try looking up by reference_id and type first (most accurate for bills)
        if (transactionData.reference_id) {
            const [refRows] = await db.query(
                'SELECT id FROM shop_transactions WHERE shop_id = ? AND type = ? AND reference_id = ? ORDER BY id DESC LIMIT 1',
                [transactionData.shop_id, transactionData.type, transactionData.reference_id]
            );
            if (refRows.length > 0) {
                return refRows[0].id;
            }
        }

        let query = `
            SELECT id, is_synced_to_sheet 
            FROM shop_transactions 
            WHERE shop_id = ? 
              AND balance_after = ?
        `;
        let params = [transactionData.shop_id, transactionData.balance_after];

        if (transactionData.type === 'Registration') {
            query += ` AND type = 'Adjustment' AND description LIKE '%Opening Balance%'`;
        } else if (transactionData.type === 'Deletion' || transactionData.type === 'Opening Balance') {
            return null;
        } else {
            query += ` AND type = ?`;
            params.push(transactionData.type);
        }

        // Match amount (handles potential negative numbers sent to webhook for payments)
        query += ` AND (amount = ? OR amount = ? OR ABS(amount) = ?)`;
        params.push(transactionData.amount, Math.abs(transactionData.amount), Math.abs(transactionData.amount));

        query += ` ORDER BY id DESC LIMIT 1`;
        
        const [rows] = await db.query(query, params);
        if (rows.length > 0) {
            return rows[0].id;
        }
    } catch (err) {
        console.error('Error finding transaction ID in webhookService:', err.message);
    }
    return null;
}

/**
 * Pushes a transaction (or batch of transactions) to the Google Sheets Ledger.
 * Saves synchronization status in the database to allow automatic retry recovery.
 */
exports.sendTransactionToWebhook = async (transactionData, explicitTxId = null) => {
    const isArray = Array.isArray(transactionData);
    
    // For a single transaction, identify the primary database record ID first
    let txId = explicitTxId;
    if (!isArray && !txId) {
        txId = transactionData.transaction_id || transactionData.txId || await findTransactionId(transactionData);
    }

    const url = process.env.LEDGER_WEBHOOK_URL;
    if (!url) {
        // If the webhook URL is not configured, mark the transaction as unsynced for later automatic retry
        if (txId) {
            try {
                if (Array.isArray(txId)) {
                    await db.query('UPDATE shop_transactions SET is_synced_to_sheet = 0 WHERE id IN (?)', [txId]);
                } else {
                    await db.query('UPDATE shop_transactions SET is_synced_to_sheet = 0 WHERE id = ?', [txId]);
                }
            } catch (dbErr) {
                console.error('Failed to update unsynced state when webhook URL is missing:', dbErr.message);
            }
        }
        return;
    }

    try {
        // Fetch accurate transaction_date from DB if txId is available
        let dbTimestamps = {};
        if (txId) {
            try {
                const idsToFetch = Array.isArray(txId) ? txId.filter(Boolean) : [txId];
                if (idsToFetch.length > 0) {
                    const [rows] = await db.query('SELECT id, transaction_date FROM shop_transactions WHERE id IN (?)', [idsToFetch]);
                    rows.forEach(r => {
                        dbTimestamps[r.id] = r.transaction_date;
                    });
                }
            } catch (dbErr) {
                console.error('Failed to fetch transaction_date for webhook:', dbErr.message);
            }
        }

        // Build current IST timestamp manually as a fallback
        const now = new Date();
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istTime = new Date(now.getTime() + istOffset);
        const istTimestamp = istTime.toISOString().replace('T', ' ').split('.')[0] + '+05:30';
        
        let payloads = [];
        if (isArray) {
            payloads = transactionData.map((item, index) => {
                const correspondingTxId = Array.isArray(txId) ? txId[index] : null;
                const dbDate = correspondingTxId ? dbTimestamps[correspondingTxId] : null;
                const timestampToUse = dbDate ? formatIST(new Date(dbDate)) : (item.timestamp || istTimestamp);
                return {
                    ...item,
                    payment_method: item.payment_method || 'N/A',
                    timestamp: timestampToUse
                };
            });
        } else {
            const dbDate = txId ? dbTimestamps[txId] : null;
            const timestampToUse = dbDate ? formatIST(new Date(dbDate)) : (transactionData.timestamp || istTimestamp);
            payloads.push({
                ...transactionData,
                payment_method: transactionData.payment_method || 'N/A',
                timestamp: timestampToUse
            });
        }

        console.log(`Pushing ${payloads.length} transaction(s) to Ledger (Google Sheets)...`);
        
        if (isArray) {
            await axios.post(url, payloads, { timeout: 60000 });
        } else {
            await axios.post(url, payloads[0], { timeout: 60000 });
        }
        
        console.log('Transaction(s) pushed to webhook successfully');

        // If the push succeeded, mark the transaction record as synced (1)
        if (txId) {
            if (Array.isArray(txId)) {
                await db.query('UPDATE shop_transactions SET is_synced_to_sheet = 1 WHERE id IN (?)', [txId]);
            } else {
                await db.query('UPDATE shop_transactions SET is_synced_to_sheet = 1 WHERE id = ?', [txId]);
            }
        }
    } catch (err) {
        console.error('CRITICAL: Failed to push transaction to ledger (Google Sheets):', err.message);
        
        // If the push failed, mark the transaction as unsynced (0) to queue it for automatic retry background task
        if (txId) {
            try {
                if (Array.isArray(txId)) {
                    await db.query('UPDATE shop_transactions SET is_synced_to_sheet = 0 WHERE id IN (?)', [txId]);
                } else {
                    await db.query('UPDATE shop_transactions SET is_synced_to_sheet = 0 WHERE id = ?', [txId]);
                }
                console.log(`Marked transaction ID(s) ${txId} as unsynced (is_synced_to_sheet = 0) for retry.`);
            } catch (dbErr) {
                console.error('Failed to update unsynced state in catch block:', dbErr.message);
            }
        }
        // Do NOT rethrow to prevent ledger issues/webhook outages from crashing the primary application
    }
};

/**
 * Background retry task to query any unsynced transactions and push them in sequence
 */
exports.retryFailedSyncs = async () => {
    const url = process.env.LEDGER_WEBHOOK_URL;
    if (!url) {
        console.log('[RETRY] Webhook URL is missing. Skipping retry task.');
        return;
    }

    console.log('[RETRY] Starting background retry of failed Google Sheets syncs...');
    
    try {
        // Query unsynced transactions, along with their parent shop information
        // Process in chronological order (t.transaction_date ASC, t.id ASC)
        const [unsynced] = await db.query(`
            SELECT t.id, t.shop_id, t.type, t.amount, t.payment_mode, t.payment_method, 
                   t.description, t.balance_after, t.created_by, t.transaction_date, t.transaction_category,
                   s.shop_name, s.village_name, s.owner_name as specific_area
            FROM shop_transactions t
            JOIN shops s ON t.shop_id = s.id
            WHERE t.is_synced_to_sheet = 0
            ORDER BY t.transaction_date ASC, t.id ASC
            LIMIT 50
        `);

        if (unsynced.length === 0) {
            console.log('[RETRY] No unsynced transactions found. All up to date.');
            return;
        }

        console.log(`[RETRY] Found ${unsynced.length} unsynced transactions. Retrying...`);

        for (const t of unsynced) {
            const amount = parseFloat(t.amount);
            const balanceAfter = parseFloat(t.balance_after);
            
            // Reconstruct the balance before mutation
            const isPayment = t.type === 'Payment' || t.type === 'Return' || (t.type !== 'Bill' && t.type !== 'Adjustment' && (t.transaction_category === 'PAYMENT' || t.transaction_category === 'RETURN'));
            const balanceBefore = isPayment ? (balanceAfter + amount) : (balanceAfter - amount);
            const amountToSend = isPayment ? -amount : amount;

            let typeToSend = t.type;
            if (t.type === 'Adjustment' && t.description && t.description.includes('Shop Registered')) {
                typeToSend = 'Registration';
            }

            const paymentMethodToSend = t.payment_mode || t.payment_method || 'N/A';

            // Format transaction date to YYYY-MM-DD HH:mm:ss in IST
            const txDate = new Date(t.transaction_date);
            const formattedTimestamp = formatIST(txDate);

            const payload = {
                shop_id: t.shop_id,
                shop_name: t.shop_name,
                village_name: t.village_name,
                specific_area: t.specific_area || '',
                type: typeToSend,
                amount: amountToSend,
                payment_method: paymentMethodToSend,
                description: t.description,
                balance_before: balanceBefore,
                balance_after: balanceAfter,
                created_by: t.created_by || 'System',
                timestamp: formattedTimestamp
            };

            try {
                console.log(`[RETRY] Retrying transaction ID ${t.id} for shop ${t.shop_name} (amount: ${amountToSend})...`);
                await axios.post(url, payload, { timeout: 15000 });
                
                // Flip synced state to 1 upon success
                await db.query('UPDATE shop_transactions SET is_synced_to_sheet = 1 WHERE id = ?', [t.id]);
                console.log(`[RETRY] Successfully synced transaction ID ${t.id}.`);
            } catch (err) {
                console.error(`[RETRY] Failed to sync transaction ID ${t.id}:`, err.message);
                // Continue to next transaction to prevent a single permanent failure from blocking the entire sync queue
                console.log('[RETRY] Continuing to next transaction in queue.');
                continue;
            }
        }
    } catch (err) {
        console.error('[RETRY] Error in retryFailedSyncs background execution:', err.message);
    }
};

