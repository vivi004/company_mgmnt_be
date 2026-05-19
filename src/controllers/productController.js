const db = require('../config/db');
const cacheService = require('../services/cacheService');
const googleSheetSyncService = require('../services/googleSheetSyncService');

/**
 * Fetches all product rates stored in the database.
 * Returns a Record<product_id, rate>.
 * Fully cached in-memory for 15 minutes to prevent DB load.
 */
exports.getProductRates = async (req, res) => {
    try {
        const cacheKey = 'product_rates_cached';
        const cached = cacheService.get(cacheKey);
        
        if (cached) {
            return res.json(cached);
        }

        // Cache miss: load latest validated rates from sheet_cache fallback layer
        const rates = await googleSheetSyncService.getSafeRates();
        
        // Cache rates for 15 minutes (900 seconds)
        cacheService.set(cacheKey, rates, 900);
        res.json(rates);
    } catch (err) {
        console.error('Error fetching product rates:', err);
        res.status(500).json({ error: 'Failed to fetch product rates' });
    }
};

/**
 * Saves/Updates product rates in the database.
 * Expects { rates: Record<product_id, rate> } in body.
 */
exports.syncProductRates = async (req, res) => {
    const { rates } = req.body;
    if (!rates || typeof rates !== 'object') {
        return res.status(400).json({ error: 'Invalid rates data' });
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

            await connection.query(
                'INSERT INTO sheet_cache (product_name, rate, is_valid) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE rate = ?, is_valid = 1',
                [id, rate, rate]
            );
        }

        await connection.commit();
        
        // Active Cache Invalidation on write
        cacheService.flush();

        res.json({ 
            success: true, 
            message: 'Product rates synced to database successfully', 
            count: Object.keys(rates).length 
        });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error syncing product rates:', err);
        res.status(500).json({ error: 'Failed to sync product rates to server' });
    } finally {
        if (connection) connection.release();
    }
};
