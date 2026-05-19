const axios = require('axios');
const { z } = require('zod');
const db = require('../config/db');
const googleAuthService = require('./googleAuthService');
const Sentry = require('@sentry/node');
const cacheService = require('./cacheService');

// 1. Zod Validation Schema for structural and data type protection
const ProductRateSchema = z.object({
    productName: z.string().min(1, 'Product name is required'),
    rate: z.number().nonnegative('Rate must be non-negative'),
    quantity: z.number().optional().nullable(),
    createdAt: z.date()
});

let consecutiveFailures = 0;

/**
 * Parses raw cell values into standard floating numbers.
 * Safe against NA, #REF!, and unexpected string text.
 */
function parsePrice(val) {
    if (val === undefined || val === null || val === '' || val === '-' || val === 'NA' || val === 'NOT AVL') return null;
    const strVal = val.toString().trim();
    if (strVal.startsWith('#')) return null;
    const num = parseFloat(strVal.replace(/,/g, ''));
    return isNaN(num) ? null : num;
}

/**
 * Replicates the exact layout mapping function from the frontend (googleSheetSync.ts)
 * to maintain 100% compatibility with older client builds.
 */
function mapSheetToProducts(rows) {
    const rates = {};

    function set(id, row, col, factor = 1) {
        if (!rows[row]) return;
        const price = parsePrice(rows[row][col]);
        if (price !== null) {
            rates[id] = price * factor;
        }
    }

    // ── Block 1 (rows 2–7): Groundnut Oil (cols A=0, B=1) ──
    set('gn-500ml', 2, 1, 0.5);
    set('gn-1l-pet', 3, 1);
    set('gn-2l', 4, 1); 
    set('gn-5l-can', 5, 1);
    set('gn-5l-can-r', 5, 1);
    set('gn-5kg-can', 6, 1);
    set('gn-15l', 7, 1);
    set('gn-15kg', 8, 1);

    // ── Block 1: Varshini Mixed Oil (cols C=2, D=3) ──
    set('mo-v-0.5po', 2, 3);
    set('mo-v-1lpo', 3, 3);
    set('mo-v-5lcan', 4, 3);
    set('mo-v-5lcan-y', 4, 3);
    set('mo-v-5lcan-ny', 17, 3);
    set('mo-v-15l', 5, 3);
    set('mo-v-15kg', 6, 3);

    // ── Block 1: Roshini Mixed Oil (row 8, cols C=2, D=3) ──
    set('mo-r-0.5lpo', 8, 3);
    set('mo-r-1lpo', 8, 3);

    // ── Block 1: ROSI GOLD Palm Oil (cols E=4, F=5) ──
    set('po-r-850g', 3, 5);
    set('po-r-820g', 4, 5);
    set('po-r-800g', 5, 5);
    set('po-r-750g', 6, 5);
    set('po-r-15l', 7, 5);
    set('po-r-15kg', 8, 5);

    // ── Block 1: Coconut Oil (cols G=6, H=7) ──
    set('cn-100ml', 2, 7, 0.1);
    set('cn-200ml', 3, 7, 0.2);
    set('cn-500ml', 4, 7, 0.5);
    set('cn-1l-pet', 5, 7);
    set('cn-5l-can', 6, 7);
    set('cn-15l', 7, 7);
    set('cn-15kg', 8, 7);

    // ── Block 1: Gingelly Oil (cols I=8, J=9) ──
    set('gg-100ml', 2, 9, 0.1);
    set('gg-200ml', 3, 9, 0.2);
    set('gg-500ml', 4, 9, 0.5);
    set('gg-1l-pet', 5, 9);
    set('gg-5l-can', 6, 9);
    set('gg-15l', 7, 9);
    set('gg-15kg', 8, 9);

    // ── Block 1: Oil Cake (cols K=10, L=11) ──
    set('oc-thool-25kg', 2, 11);
    set('oc-thool-50kg', 3, 11);
    set('oc-katti-25kg', 5, 11);
    set('oc-katti-50kg', 6, 11);

    // ── Block 2 (rows 10–16): Castor Oil (cols A=0, B=1) ──
    set('cs-100ml', 10, 1, 0.1);
    set('cs-200ml', 11, 1, 0.2);
    set('cs-500ml', 12, 1, 0.5);
    set('cs-1l-pet', 13, 1);
    set('cs-5l-can', 14, 1);
    set('cs-15l', 15, 1);
    set('cs-15kg', 16, 1);

    // ── Block 2: Lamp Oil (cols C=2, D=3) ──
    set('lo-100ml', 10, 3, 0.1);
    set('lo-200ml', 11, 3, 0.2);
    set('lo-500ml', 12, 3, 0.5);
    set('lo-1l-pet', 13, 3);
    set('lo-5l-can', 14, 3);
    set('lo-15l', 15, 3);
    set('lo-15kg', 16, 3);

    // ── Block 2: Neem Oil (cols E=4, F=5) ──
    set('nm-100ml', 10, 5, 0.1);
    set('nm-200ml', 11, 5, 0.2);
    set('nm-500ml', 12, 5, 0.5);
    set('nm-1l-pet', 13, 5);
    set('nm-5l-can', 14, 5);
    set('nm-15l', 15, 5);
    set('nm-15kg', 16, 5);

    // ── Block 2: Mahua Oil (cols G=6, H=7) ──
    set('mo-100ml', 10, 7, 0.1);
    set('mo-200ml', 11, 7, 0.2);
    set('mo-500ml', 12, 7, 0.5);
    set('mo-1l-pet', 13, 7);
    set('mo-5l-can', 14, 7);
    set('mo-15l', 15, 7);
    set('mo-15kg', 16, 7);

    // ── Block 2: Burfi (cols I=8, J=9, row 16) ──
    set('bu-k-barfi', 16, 9);

    return rates;
}

/**
 * Background Scheduler Google Sheet Synchronizer
 */
async function syncGoogleSheetsRates() {
    const sheetId = process.env.GOOGLE_SHEET_ID || '1gSE3fMAzka_eIlIU2sFR4xC4_IxJTeHAgJkp5YQCSvM';
    console.log('[SHEET SYNC] Starting background rate sync execution...');
    
    try {
        const accessToken = await googleAuthService.getAccessToken();
        let url;
        let headers = {};

        if (accessToken) {
            // Secure Service Account authenticated fetch
            url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:Z100?valueRenderOption=UNFORMATTED_VALUE`;
            headers = { Authorization: `Bearer ${accessToken}` };
            console.log('[SHEET SYNC] Authenticated via Service Account.');
        } else {
            // Public Sheet fetch fallback
            const apiKey = process.env.GOOGLE_SHEETS_API_KEY || process.env.VITE_GOOGLE_SHEETS_API_KEY;
            if (!apiKey) {
                throw new Error('Neither Google Service Account credentials nor Public API Key was configured.');
            }
            url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:Z100?key=${apiKey}&valueRenderOption=UNFORMATTED_VALUE`;
            console.log('[SHEET SYNC] Falling back to Public API Key fetch.');
        }

        const response = await axios.get(url, { headers, timeout: 10000 });
        const rows = response.data.values || [];

        if (rows.length < 10) {
            throw new Error(`Invalid Spreadsheet shape: fewer than 10 rows retrieved (${rows.length}).`);
        }

        const mappedRates = mapSheetToProducts(rows);
        const validatedRates = {};
        let skippedRowsCount = 0;
        const now = new Date();

        // 2. Validate parsed product rates using Zod
        for (const [productId, rateValue] of Object.entries(mappedRates)) {
            try {
                // Ensure row satisfies the target schema
                const validated = ProductRateSchema.parse({
                    productName: productId,
                    rate: rateValue,
                    createdAt: now
                });
                validatedRates[validated.productName] = validated.rate;
            } catch (validationErr) {
                skippedRowsCount++;
                console.error(`[SHEET SYNC ROW SKIP] Column/Row validation failed for "${productId}":`, validationErr.message);
                if (process.env.SENTRY_DSN) {
                    Sentry.captureException(validationErr, { extra: { productId, rateValue } });
                }
            }
        }

        // Alert admin if invalid skipped rows exceed our threshold limit (e.g., 5 rows failed)
        if (skippedRowsCount > 5) {
            const warningMsg = `[CRITICAL WARNING] Google Sheet has ${skippedRowsCount} corrupted rows! Please inspect sheet structure.`;
            console.error(`\x1b[31m${warningMsg}\x1b[0m`);
            if (process.env.SENTRY_DSN) {
                Sentry.captureMessage(warningMsg, 'error');
            }
        }

        // 3. Upsert validated rates into MySQL `sheet_cache`
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            for (const [id, rate] of Object.entries(validatedRates)) {
                await connection.query(`
                    INSERT INTO sheet_cache (product_name, rate, is_valid) 
                    VALUES (?, ?, 1) 
                    ON DUPLICATE KEY UPDATE rate = VALUES(rate), is_valid = 1
                `, [id, rate]);

                // Maintain alignment with legacy tables
                await connection.query(`
                    INSERT INTO product_rates (product_id, rate) 
                    VALUES (?, ?) 
                    ON DUPLICATE KEY UPDATE rate = VALUES(rate)
                `, [id, rate]);
            }
            await connection.commit();
            console.log(`[SHEET SYNC] Successfully updated sheet_cache with ${Object.keys(validatedRates).length} validated rates.`);
            
            consecutiveFailures = 0; // Reset consecutive failures on successful run
            cacheService.flush();   // Flush general dashboard and rates caches

        } catch (dbErr) {
            await connection.rollback();
            throw dbErr;
        } finally {
            connection.release();
        }

    } catch (err) {
        consecutiveFailures++;
        console.error(`\x1b[31m[SHEET SYNC ERROR] Execution failed: ${err.message}\x1b[0m`);
        
        if (process.env.SENTRY_DSN) {
            Sentry.captureException(err, { extra: { consecutiveFailures } });
        }

        // Notify admin immediately if background sheets syncing fails 3 consecutive times
        if (consecutiveFailures >= 3) {
            const fatalMsg = `[CRITICAL ALERT] Google Sheet Sync service failed ${consecutiveFailures} consecutive times! Apps are running on stale DB cache.`;
            console.error(`\x1b[31m${fatalMsg}\x1b[0m`);
            if (process.env.SENTRY_DSN) {
                Sentry.captureMessage(fatalMsg, 'fatal');
            }
        }
    }
}

/**
 * Returns latest safe rates from database (sheet_cache fallback layer)
 */
async function getSafeRates() {
    try {
        const [rows] = await db.query('SELECT product_name, rate FROM sheet_cache WHERE is_valid = 1');
        
        if (rows.length === 0) {
            // Double fallback to product_rates
            const [fallbackRows] = await db.query('SELECT product_id as product_name, rate FROM product_rates');
            const rates = {};
            fallbackRows.forEach(r => rates[r.product_name] = parseFloat(r.rate));
            return rates;
        }
        
        const rates = {};
        rows.forEach(r => rates[r.product_name] = parseFloat(r.rate));
        return rates;
    } catch (err) {
        console.error('[DB FALLBACK FATAL] Failed to retrieve safe rates:', err.message);
        if (process.env.SENTRY_DSN) {
            Sentry.captureException(err);
        }
        return {};
    }
}

module.exports = {
    syncGoogleSheetsRates,
    getSafeRates
};
