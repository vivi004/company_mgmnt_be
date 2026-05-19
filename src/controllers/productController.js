const db = require('../config/db');
const Sentry = require('@sentry/node');

/**
 * Fetches all product rates stored in the database.
 * Returns a Record<product_id, rate>
 * Never returns empty data to web/mobile app.
 */
exports.getProductRates = async (req, res) => {
    try {
        const [rows] = await db.query('SELECT product_id, rate FROM product_rates');
        const rates = {};
        rows.forEach(row => {
            rates[row.product_id] = parseFloat(row.rate);
        });

        // Prevention: If database product_rates table is completely empty, restore from the latest valid backup
        if (Object.keys(rates).length === 0) {
            console.warn('[DB WARNING] product_rates table is empty. Attempting to restore from latest sheet_backup...');
            const [backups] = await db.query('SELECT data FROM sheet_backup WHERE is_valid = 1 ORDER BY id DESC LIMIT 1');
            if (backups.length > 0) {
                const backupData = JSON.parse(backups[0].data);
                console.log('[DB RECOVERY] Restoring rates from sheet_backup containing', Object.keys(backupData).length, 'rates');
                
                // Return backup immediately to frontend so it doesn't get empty data
                res.json(backupData);

                // Asynchronously repair the product_rates table
                const connection = await db.getConnection();
                try {
                    await connection.beginTransaction();
                    for (const [id, rate] of Object.entries(backupData)) {
                        if (rate === null || rate === undefined) continue;
                        await connection.query(
                            'INSERT INTO product_rates (product_id, rate) VALUES (?, ?) ON DUPLICATE KEY UPDATE rate = ?',
                            [id, rate, rate]
                        );
                    }
                    await connection.commit();
                    console.log('[DB RECOVERY] Successfully auto-repaired product_rates table.');
                } catch (repairErr) {
                    await connection.rollback();
                    console.error('[DB RECOVERY FATAL] Failed to auto-repair product_rates:', repairErr);
                    if (process.env.SENTRY_DSN) {
                        Sentry.captureException(repairErr);
                    }
                } finally {
                    connection.release();
                }
                return;
            }
        }

        res.json(rates);
    } catch (err) {
        console.error('Error fetching product rates:', err);
        if (process.env.SENTRY_DSN) {
            Sentry.captureException(err);
        }
        res.status(500).json({ error: 'Failed to fetch product rates' });
    }
};

/**
 * Saves/Updates product rates in the database.
 * Expects { rates: Record<product_id, rate> } in body
 */
exports.syncProductRates = async (req, res) => {
    let { rates } = req.body;
    let fallbackUsed = false;

    // Protection 1: If incoming payload is completely empty or invalid, fall back automatically to the last valid backup
    if (!rates || typeof rates !== 'object' || Object.keys(rates).length === 0) {
        console.warn('[SYNC WARNING] Received empty/invalid rates payload. Triggering automatic backup recovery...');
        try {
            const [backups] = await db.query('SELECT data FROM sheet_backup WHERE is_valid = 1 ORDER BY id DESC LIMIT 1');
            if (backups.length > 0) {
                rates = JSON.parse(backups[0].data);
                fallbackUsed = true;
                console.log('[SYNC RECOVERY] Successfully retrieved fallback rates backup containing', Object.keys(rates).length, 'entries.');
            } else {
                return res.status(400).json({ error: 'Invalid rates data and no valid backup exists to restore.' });
            }
        } catch (backupErr) {
            console.error('[SYNC RECOVERY FATAL] Failed to read backups:', backupErr);
            if (process.env.SENTRY_DSN) {
                Sentry.captureException(backupErr);
            }
            return res.status(500).json({ error: 'Failed to process sync due to server error' });
        }
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        
        // Upsert rates
        for (const [id, rate] of Object.entries(rates)) {
            if (rate === null || rate === undefined) continue;
            
            await connection.query(
                'INSERT INTO product_rates (product_id, rate) VALUES (?, ?) ON DUPLICATE KEY UPDATE rate = ?',
                [id, rate, rate]
            );
        }

        // Protection 2: Save successful, valid rates payload to sheet_backup table (only if we didn't just load from backup itself)
        if (!fallbackUsed) {
            await connection.query(
                'INSERT INTO sheet_backup (data, is_valid) VALUES (?, 1)',
                [JSON.stringify(rates)]
            );
            console.log('[SYNC SUCCESS] Successfully backed up rates payload containing', Object.keys(rates).length, 'entries.');
        }

        // Store global synchronization timestamp in Indian Standard Time (IST)
        const syncTimeStr = new Date().toLocaleString('en-IN', { hour12: true, timeZone: 'Asia/Kolkata' });
        await connection.query(
            'UPDATE app_settings SET last_sheet_sync_time = ? WHERE id = 1',
            [syncTimeStr]
        );

        await connection.commit();
        res.json({ 
            success: true, 
            message: fallbackUsed ? 'Rates restored from latest valid backup due to empty payload' : 'Product rates synced to database successfully', 
            count: Object.keys(rates).length,
            fallback_used: fallbackUsed,
            last_sheet_sync_time: syncTimeStr
        });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error syncing product rates:', err);
        if (process.env.SENTRY_DSN) {
            Sentry.captureException(err);
        }
        res.status(500).json({ error: 'Failed to sync product rates to server' });
    } finally {
        if (connection) connection.release();
    }
};
