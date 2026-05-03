const db = require('../config/db');

/**
 * Fetches all product rates stored in the database.
 * Returns a Record<product_id, rate>
 */
exports.getProductRates = async (req, res) => {
    try {
        const [rows] = await db.query('SELECT product_id, rate FROM product_rates');
        const rates = {};
        rows.forEach(row => {
            rates[row.product_id] = parseFloat(row.rate);
        });
        res.json(rates);
    } catch (err) {
        console.error('Error fetching product rates:', err);
        res.status(500).json({ error: 'Failed to fetch product rates' });
    }
};

/**
 * Saves/Updates product rates in the database.
 * Expects { rates: Record<product_id, rate> } in body
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
        }

        await connection.commit();
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
