const db = require('../config/db');
const webhookService = require('../services/webhookService');
const financialService = require('../services/financialService');
const cacheService = require('../services/cacheService');

const DEFAULT_PRODUCTS = {
    // Nisha Oils
    'gn-500ml': { price: 110, size: '500 ml', brand: 'Nisha' },
    'gn-1l-pet': { price: 220, size: '1 ltr', brand: 'Nisha' },
    'gn-2l': { price: 440, size: '2 ltr', brand: 'Nisha' },
    'gn-5l-can': { price: 1100, size: '5 Ltr Can', brand: 'Nisha' },
    'gn-5l-can-r': { price: 1100, size: '5 Ltr Can', brand: 'Nisha' },
    'gn-5kg-can': { price: 1245, size: '5 Kg Can', brand: 'Nisha' },
    'gn-15l': { price: 3260, size: '15 LTR', brand: 'Nisha' },
    'gn-15kg': { price: 3530, size: '15 KG', brand: 'Nisha' },

    'cn-100ml': { price: 38, size: '100 ml', brand: 'Nisha' },
    'cn-200ml': { price: 74, size: '200 ml', brand: 'Nisha' },
    'cn-500ml': { price: 175, size: '500 ml', brand: 'Nisha' },
    'cn-1l-pet': { price: 350, size: '1 ltr', brand: 'Nisha' },
    'cn-5l-can': { price: 1750, size: '5 Ltr Can', brand: 'Nisha' },
    'cn-15l': { price: 5175, size: '15 LTR', brand: 'Nisha' },
    'cn-15kg': { price: 5642.5, size: '15 KG', brand: 'Nisha' },

    'cs-100ml': { price: 29, size: '100 ml', brand: 'Nisha' },
    'cs-200ml': { price: 56, size: '200 ml', brand: 'Nisha' },
    'cs-500ml': { price: 130, size: '500 ml', brand: 'Nisha' },
    'cs-1l-pet': { price: 260, size: '1 ltr', brand: 'Nisha' },
    'cs-5l-can': { price: 1300, size: '5 Ltr Can', brand: 'Nisha' },
    'cs-15l': { price: 3825, size: '15 LTR', brand: 'Nisha' },
    'cs-15kg': { price: 4157.5, size: '15 KG', brand: 'Nisha' },

    'lo-100ml': { price: 18, size: '100 ml', brand: 'Nisha' },
    'lo-200ml': { price: 34, size: '200 ml', brand: 'Nisha' },
    'lo-500ml': { price: 75, size: '500 ml', brand: 'Nisha' },
    'lo-1l-pet': { price: 150, size: '1 ltr', brand: 'Nisha' },
    'lo-5l-can': { price: 750, size: '5 Ltr Can', brand: 'Nisha' },
    'lo-15l': { price: 2100, size: '15 LTR', brand: 'Nisha' },
    'lo-15kg': { price: 2250, size: '15 KG', brand: 'Nisha' },

    'gg-100ml': { price: 38, size: '100 ml', brand: 'Nisha' },
    'gg-200ml': { price: 74, size: '200 ml', brand: 'Nisha' },
    'gg-500ml': { price: 175, size: '500 ml', brand: 'Nisha' },
    'gg-1l-pet': { price: 350, size: '1 ltr', brand: 'Nisha' },
    'gg-5l-can': { price: 1750, size: '5 Ltr Can', brand: 'Nisha' },
    'gg-15l': { price: 5175, size: '15 LTR', brand: 'Nisha' },
    'gg-15kg': { price: 5642.5, size: '15 KG', brand: 'Nisha' },

    'mo-100ml': { price: 29, size: '100 ml', brand: 'Nisha' },
    'mo-200ml': { price: 56, size: '200 ml', brand: 'Nisha' },
    'mo-500ml': { price: 130, size: '500 ml', brand: 'Nisha' },
    'mo-1l-pet': { price: 260, size: '1 ltr', brand: 'Nisha' },
    'mo-5l-can': { price: 1300, size: '5 Ltr Can', brand: 'Nisha' },
    'mo-15l': { price: 3825, size: '15 LTR', brand: 'Nisha' },
    'mo-15kg': { price: 4157.5, size: '15 KG', brand: 'Nisha' },

    'nm-100ml': { price: 39, size: '100 ml', brand: 'Nisha' },
    'nm-200ml': { price: 76, size: '200 ml', brand: 'Nisha' },
    'nm-500ml': { price: 180, size: '500 ml', brand: 'Nisha' },
    'nm-1l-pet': { price: 360, size: '1 ltr', brand: 'Nisha' },
    'nm-5l-can': { price: 1800, size: '5 Ltr Can', brand: 'Nisha' },
    'nm-15l': { price: 5325, size: '15 LTR', brand: 'Nisha' },
    'nm-15kg': { price: 5807.5, size: '15 KG', brand: 'Nisha' },

    'vs-gn-500ml-box': { price: 2200, size: '500 ml box', brand: 'VARSHINI' },
    'vs-gn-1l-box': { price: 2200, size: '1 LTR box', brand: 'VARSHINI' },

    // Mixed Oils / Varshini Gold
    'mo-v-0.5po': { price: 1500, size: '1/2 Pkt', brand: 'VARSHINI' },
    'mo-v-1lpo': { price: 1500, size: '1 Ltr Pkt', brand: 'VARSHINI' },
    'mo-v-5lcan': { price: 775, size: '5 Ltr Can', brand: 'VARSHINI' },
    'mo-v-5lcan-y': { price: 800, size: '5 Ltr Can', brand: 'VARSHINI' },
    'mo-v-5lcan-ny': { price: 820, size: '5 Ltr Can', brand: 'VARSHINI' },
    'mo-v-15l': { price: 2230, size: '15 LTR', brand: 'VARSHINI' },
    'mo-v-15kg': { price: 2440, size: '15 KG', brand: 'VARSHINI' },
    'mo-r-0.5lpo': { price: 1380, size: '1/2 Ltr ', brand: 'ROSHINI' },
    'mo-r-1lpo': { price: 1380, size: '1 Ltr ', brand: 'ROSHINI' },

    // Palm Oil
    'po-r-850g': { price: 1320, size: '850 GM', brand: 'ROSI GOLD' },
    'po-r-820g': { price: 1280, size: '820 GM', brand: 'ROSI GOLD' },
    'po-r-800g': { price: 1250, size: '800 GM', brand: 'ROSI GOLD' },
    'po-r-750g': { price: 1185, size: '750 GM', brand: 'ROSI GOLD' },
    'po-r-15l': { price: 2180, size: '15 LTR', brand: 'ROSI GOLD' },
    'po-r-15kg': { price: 2400, size: '15 KG', brand: 'ROSI GOLD' },

    // Burfi
    'bu-k-barfi': { price: 110, size: 'JAR', brand: 'Nisha' },

    // Oil Cake
    'oc-thool-25kg': { price: 1525, size: '25 KG', brand: 'Nisha' },
    'oc-thool-50kg': { price: 3000, size: '50 KG', brand: 'Nisha' },
    'oc-katti-25kg': { price: 1500, size: '25 KG', brand: 'Nisha' },
    'oc-katti-50kg': { price: 2950, size: '50 KG', brand: 'Nisha' }
};

function recalculateTotalAmount(cart, customRates, dbRates) {
    let total = 0;
    
    // Normalize inputs
    const parsedCart = typeof cart === 'string' ? JSON.parse(cart) : (cart || {});
    const parsedCustom = typeof customRates === 'string' ? JSON.parse(customRates) : (customRates || {});
    const ratesLookup = dbRates || {};

    for (const [key, quantity] of Object.entries(parsedCart)) {
        if (!quantity || quantity <= 0) continue;

        let baseId = key;
        let isBox = false;
        let isLtr = false;
        let isWl = false;

        let workingKey = key;
        if (workingKey.endsWith('_wl')) {
            isWl = true;
            workingKey = workingKey.slice(0, -3);
        }

        if (workingKey.endsWith('_box')) {
            baseId = workingKey.slice(0, -4);
            isBox = true;
        } else if (workingKey.endsWith('_ltr')) {
            baseId = workingKey.slice(0, -4);
            isLtr = true;
        } else {
            baseId = workingKey;
        }

        // Get base price: customRates overrides database rates, which overrides hardcoded defaults
        const defaultProd = DEFAULT_PRODUCTS[baseId];
        const defaultPrice = defaultProd ? defaultProd.price : 0;
        const basePrice = parsedCustom[baseId] !== undefined ? parseFloat(parsedCustom[baseId]) : (ratesLookup[baseId] !== undefined ? parseFloat(ratesLookup[baseId]) : defaultPrice);

        const isNisha = defaultProd ? defaultProd.brand === 'Nisha' : false;
        const size = defaultProd ? defaultProd.size.toLowerCase() : '';

        const is100ml = isNisha && size === '100 ml';
        const is200ml = isNisha && size === '200 ml';
        const is500ml = isNisha && size === '500 ml';
        const is1L = isNisha && (size === '1 litre' || size === '1 ltr-pet' || size === '1 ltr');
        const is2L = isNisha && size === '2 ltr';

        if (isBox) {
            const multiplier = is100ml ? 50 : is200ml ? 25 : is500ml ? 20 : is1L ? 10 : is2L ? 5 : 1;
            const rate = basePrice * multiplier;
            total += rate * parseFloat(quantity);
        } else if (isLtr) {
            const multiplierLtr = is100ml ? 10 : is200ml ? 5 : is500ml ? 2 : 1;
            const finalQty = (is100ml || is200ml || is500ml) ? parseFloat(quantity) * multiplierLtr : parseFloat(quantity);
            total += basePrice * finalQty;
        } else {
            // Check if there is an item-specific override in custom rates (for non-variant base products)
            const itemRate = parsedCustom[workingKey] !== undefined ? parseFloat(parsedCustom[workingKey]) : (ratesLookup[workingKey] !== undefined ? parseFloat(ratesLookup[workingKey]) : defaultPrice);
            total += itemRate * parseFloat(quantity);
        }
    }

    return Math.round(total * 100) / 100;
}

exports.createBill = async (req, res) => {
    const { shop_id, phone, cart, custom_rates, bill_date, status, total_amount, delivery_date, is_edited_price, is_edited_qty, is_edited_date } = req.body;
    let { shop_name, village_name, created_by } = req.body;
    
    // Trim names to prevent lookup errors
    shop_name = shop_name?.trim();
    village_name = village_name?.trim();

    // Safety check: If created_by is missing, fetch the acting user's name from the DB
    if (!created_by && req.user && req.user.id) {
        try {
            const [users] = await db.query('SELECT first_name, last_name FROM employees WHERE id = ?', [req.user.id]);
            if (users.length > 0) {
                created_by = `${users[0].first_name} ${users[0].last_name || ''}`.trim();
            }
        } catch (e) {
            console.error('Failed to fetch user name for bill creation:', e);
        }
    }

    if ((!shop_id && (!shop_name || !village_name)) || !cart) {
        return res.status(400).json({
            message: 'Missing required fields',
            detail: 'Shop ID or (Shop Name and Village Name), and cart are required.'
        });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get the shop ID, current balance, and order_line_id
        let shop;
        if (shop_id) {
            const [rows] = await connection.query(`
                SELECT s.id, COALESCE(sb.balance, 0) as balance, s.order_line_id, s.shop_name, s.village_name, s.owner_name as specific_area 
                FROM shops s
                LEFT JOIN shop_balances sb ON s.id = sb.shop_id
                WHERE s.id = ? FOR UPDATE
            `, [shop_id]);
            if (rows.length > 0) shop = rows[0];
        }

        if (!shop) {
            let [shops] = await connection.query(`
                SELECT s.id, COALESCE(sb.balance, 0) as balance, s.order_line_id, s.shop_name, s.village_name 
                FROM shops s
                LEFT JOIN shop_balances sb ON s.id = sb.shop_id
                WHERE TRIM(s.shop_name) = TRIM(?) AND TRIM(s.village_name) = TRIM(?) FOR UPDATE
            `, [shop_name, village_name]);

            if (shops.length === 0) {
                // AUTO-CREATE SHOP
                console.log(`Shop "${shop_name}" not found. Auto-creating...`);
                
                let [orderLines] = await connection.query('SELECT id FROM order_lines WHERE TRIM(name) = TRIM(?)', [village_name]);
                let orderLineId;
                
                if (orderLines.length > 0) {
                    orderLineId = orderLines[0].id;
                } else {
                    const nodeId = `TEMP-${Date.now()}`;
                    const [olResult] = await connection.query(
                        'INSERT INTO order_lines (name, node_id) VALUES (?, ?)',
                        [village_name, nodeId]
                    );
                    orderLineId = olResult.insertId;
                }

                const [shopResult] = await connection.query(
                    'INSERT INTO shops (order_line_id, shop_name, village_name, phone) VALUES (?, ?, ?, ?)',
                    [orderLineId, shop_name, village_name, phone || '']
                );
                const newShopId = shopResult.insertId;
                
                // Initialize balance
                await connection.query('INSERT INTO shop_balances (shop_id, balance) VALUES (?, ?)', [newShopId, 0]);

                shop = { id: newShopId, balance: 0, order_line_id: orderLineId, shop_name, village_name, specific_area: '' };

                // Log new shop creation to ledger webhook
                webhookService.sendTransactionToWebhook({
                    shop_id: shop.id,
                    shop_name: shop_name,
                    village_name: village_name,
                    specific_area: '',
                    type: 'Registration',
                    amount: 0,
                    description: 'Auto-created via Manual Bill Generation',
                    balance_before: 0,
                    balance_after: 0,
                    created_by: created_by || 'Admin'
                });
            } else {
                shop = shops[0];
            }
        }

        // 3. Get and Lock the next invoice number
        const [rows] = await connection.query('SELECT next_invoice_no FROM app_settings WHERE id = 1 FOR UPDATE');
        
        if (rows.length === 0) {
            // This should not happen if initialized correctly, but as a fallback:
            await connection.query('INSERT IGNORE INTO app_settings (id, next_invoice_no, last_invoice_no) VALUES (1, 1001, 1000)');
            var [fallbackRows] = await connection.query('SELECT next_invoice_no FROM app_settings WHERE id = 1 FOR UPDATE');
            var assignedInvoiceNo = fallbackRows[0]?.next_invoice_no || 1001;
        } else {
            var assignedInvoiceNo = rows[0].next_invoice_no;
        }

        // 4. Prepare the date in strictly IST (Indian Standard Time)
        let mysqlDate;
        try {
            const parsed = bill_date ? new Date(bill_date) : new Date();
            if (isNaN(parsed.getTime())) throw new Error('Invalid date');
            const istTime = new Date(parsed.getTime() + 5.5 * 60 * 60 * 1000);
            mysqlDate = istTime.toISOString().slice(0, 19).replace('T', ' ');
        } catch (e) {
            const istTime = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
            mysqlDate = istTime.toISOString().slice(0, 19).replace('T', ' ');
        }

        let mysqlDeliveryDate = null;
        if (delivery_date) {
            try {
                const parsedDelivery = new Date(delivery_date);
                if (!isNaN(parsedDelivery.getTime())) {
                    const istD = new Date(parsedDelivery.getTime() + 5.5 * 60 * 60 * 1000);
                    mysqlDeliveryDate = istD.toISOString().slice(0, 19).replace('T', ' ');
                }
            } catch (e) { 
                mysqlDeliveryDate = mysqlDate;
            }
        }
        if (!mysqlDeliveryDate) {
            mysqlDeliveryDate = mysqlDate;
        }

        // 5. Handle Balance Application (Deferred if delivery date is in the future)
        const cartJson = typeof cart === 'string' ? cart : JSON.stringify(cart);
        const ratesJson = typeof custom_rates === 'string' ? custom_rates : JSON.stringify(custom_rates || {});

        // Fetch DB rates for server-side total verification
        const [dbRatesRows] = await connection.query('SELECT product_id, rate FROM product_rates');
        const dbRates = {};
        dbRatesRows.forEach(row => {
            dbRates[row.product_id] = parseFloat(row.rate);
        });

        const computedAmount = recalculateTotalAmount(cart, custom_rates, dbRates);
        const amount = computedAmount;

        if (total_amount !== undefined && Math.abs(computedAmount - parseFloat(total_amount)) > 1.0) {
            console.warn(`[SECURITY WARNING] Mismatch in total_amount for Shop #${shop.id}. Client sent: ${total_amount}, Computed: ${computedAmount}. Enforcing computed total.`);
        }

        const [dateRows] = await connection.query("SELECT DATE_FORMAT(CONVERT_TZ(NOW(), '+00:00', '+05:30'), '%Y-%m-%d') as today");
        const todayStr = dateRows[0].today;
        
        const billDateOnly = mysqlDate.split(' ')[0];
        const deliveryDateOnly = mysqlDeliveryDate ? mysqlDeliveryDate.split(' ')[0] : billDateOnly;
        const isFutureBill = deliveryDateOnly > todayStr;

        // ── BALANCE APPLICATION ──
        // Future-dated bills: do NOT apply to shop_balances immediately.
        // They will be applied by the midnight cron on delivery date.
        let finalBalance = parseFloat(shop.balance);
        let isAppliedNow = 0;
        if (!isFutureBill) {
            finalBalance += amount;
            isAppliedNow = 1;
            await connection.query(
                'INSERT INTO shop_balances (shop_id, balance) VALUES (?, ?) ON DUPLICATE KEY UPDATE balance = VALUES(balance)',
                [shop.id, finalBalance]
            );
        }

        const [billResult] = await connection.query(
            'INSERT INTO bills (shop_id, invoice_no, shop_name, village_name, cart, custom_rates, created_by, bill_date, delivery_date, status, total_amount, is_edited_price, is_edited_qty, is_edited_date, is_applied_to_balance, original_cart, original_delivery_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [shop.id, String(assignedInvoiceNo), shop.shop_name, shop.village_name, cartJson, ratesJson, created_by || 'Staff', mysqlDate, mysqlDeliveryDate, status || 'Unverified', amount, is_edited_price ? 1 : 0, is_edited_qty ? 1 : 0, is_edited_date ? 1 : 0, isAppliedNow, cartJson, mysqlDeliveryDate]
        );

        // 8. Increment the next invoice number
        await connection.query(
            'UPDATE app_settings SET next_invoice_no = next_invoice_no + 1, last_invoice_no = ? WHERE id = 1',
            [assignedInvoiceNo]
        );

        if (!isFutureBill) {
            // 7. Create Shop Transaction (Ledger Entry)
            await connection.query(
                'INSERT INTO shop_transactions (shop_id, type, amount, reference_id, description, balance_after, created_by, transaction_date, transaction_category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [shop.id, 'Bill', amount, billResult.insertId, `Invoice #${assignedInvoiceNo}`, finalBalance, created_by || 'Staff', mysqlDeliveryDate || mysqlDate, 'BILL']
            );

            // Push to Webhook (Google Sheets)
            webhookService.sendTransactionToWebhook({
                shop_id: shop.id,
                shop_name: shop.shop_name,
                village_name: shop.village_name,
                specific_area: shop.specific_area || '',
                type: 'Bill',
                amount: amount,
                description: `Invoice #${assignedInvoiceNo}`,
                balance_before: shop.balance,
                balance_after: finalBalance,
                created_by: created_by || 'Staff',
                reference_id: billResult.insertId
            });
        }

        // 8b. Update daily_collections
        const shopOrderLineId = shop.order_line_id;

        if (isFutureBill) {
            // ── CASE A: FUTURE BILL (Deferred) ──
            // 1. Add to the future delivery date row
            await connection.query(`
                INSERT INTO daily_collections
                    (shop_id, shop_name, village_name, order_line_id, collection_date,
                     todays_bill_amount, old_balance, total_balance, future_bills, manual_adjustments)
                VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, 0)
                ON DUPLICATE KEY UPDATE
                    todays_bill_amount = todays_bill_amount + VALUES(todays_bill_amount),
                    total_balance = old_balance + todays_bill_amount - (cash_collected + upi_collected + cheque_collected) + manual_adjustments
            `, [shop.id, shop.shop_name, shop.village_name, shopOrderLineId,
                deliveryDateOnly, amount, amount]);

            // 2. Update Today's row informational column (future_bills) — NOT total_balance
            await connection.query(`
                INSERT INTO daily_collections
                    (shop_id, shop_name, village_name, order_line_id, collection_date,
                     future_bills, old_balance, total_balance, manual_adjustments)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
                ON DUPLICATE KEY UPDATE
                    future_bills = future_bills + VALUES(future_bills)
            `, [shop.id, shop.shop_name, shop.village_name, shopOrderLineId,
                todayStr, amount, parseFloat(shop.balance), parseFloat(shop.balance)]);
        } else {
            // ── CASE B: TODAY OR BACKDATED BILL (Immediate) ──
            // 1. Update the row for the ACTUAL delivery date
            await connection.query(`
                INSERT INTO daily_collections
                    (shop_id, shop_name, village_name, order_line_id, collection_date,
                     todays_bill_amount, old_balance, total_balance, future_bills, manual_adjustments)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
                ON DUPLICATE KEY UPDATE
                    todays_bill_amount = todays_bill_amount + VALUES(todays_bill_amount),
                    total_balance = old_balance + todays_bill_amount - (cash_collected + upi_collected + cheque_collected) + manual_adjustments
            `, [shop.id, shop.shop_name, shop.village_name, shopOrderLineId,
                deliveryDateOnly, amount, parseFloat(shop.balance) - amount, finalBalance]);

            // 2. MASTER SYNC: Heal the ledger starting from the delivery date
            await financialService.rebuildRipple(connection, shop.id, deliveryDateOnly);
        }

        await connection.commit();
        cacheService.flush();

        // Webhook moved inside !isFutureBill block above

        res.status(201).json({
            message: isFutureBill ? `Bill scheduled for delivery on ${deliveryDateOnly}` : 'Bill created and applied to balance successfully',
            id: billResult.insertId,
            invoice_no: assignedInvoiceNo,
            new_balance: finalBalance,
            is_deferred: isFutureBill
        });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('CRITICAL ERROR during createBill:', err);
        res.status(500).json({
            message: `Failed to create bill: ${err.message}`,
            detail: err.message
        });
    } finally {
        if (connection) connection.release();
    }
};

exports.getAllBills = async (req, res) => {
    const limit = parseInt(req.query.limit) || 1000;
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * limit;

    try {
        // Primary ledger = only verified bills
        const [rows] = await db.query(`
            SELECT b.id, b.shop_id, b.invoice_no, b.shop_name, b.village_name, b.cart, b.custom_rates, 
                   b.created_by, b.bill_date, b.delivery_date, b.status, b.total_amount, b.is_edited_price, b.is_edited_qty, b.is_edited_date, 
                   b.is_applied_to_balance, b.created_at, b.original_cart, b.original_delivery_date, 
                   s.phone, s.phone2, s.order_line_id, s.owner_name as specific_area, ol.area_name,
                   COALESCE(
                       dc.old_balance, 
                       COALESCE(
                           prev.total_balance, 
                           COALESCE(
                               (
                                   SELECT tx.balance_after 
                                   FROM shop_transactions tx 
                                   WHERE tx.shop_id = b.shop_id 
                                     AND tx.transaction_date < DATE(b.delivery_date) 
                                     AND tx.approval_status = 'APPROVED'
                                   ORDER BY tx.transaction_date DESC, tx.id DESC 
                                   LIMIT 1
                               ),
                               IF(DATE(s.created_at) <= DATE(b.delivery_date), COALESCE(sb.opening_balance, 0), 0)
                           )
                       )
                   ) AS old_balance
            FROM bills b 
            LEFT JOIN shops s ON b.shop_id = s.id
            LEFT JOIN order_lines ol ON s.order_line_id = ol.id
            LEFT JOIN shop_balances sb ON b.shop_id = sb.shop_id
            LEFT JOIN daily_collections dc ON b.shop_id = dc.shop_id AND dc.collection_date = DATE(b.delivery_date)
            LEFT JOIN daily_collections prev ON b.shop_id = prev.shop_id AND prev.collection_date = (
                SELECT MAX(collection_date)
                FROM daily_collections
                WHERE shop_id = b.shop_id AND collection_date < DATE(b.delivery_date)
            )
            WHERE b.status = "Verified" 
            ORDER BY b.delivery_date DESC, b.id DESC
            LIMIT ? OFFSET ?
        `, [limit, offset]);
        const mapped = rows.map(row => {
            let cart = row.cart;
            let custom_rates = row.custom_rates;
            try { if (typeof cart === 'string') cart = JSON.parse(cart); } catch { cart = {}; }
            try { if (typeof custom_rates === 'string') custom_rates = JSON.parse(custom_rates); } catch { custom_rates = {}; }
            let original_cart = row.original_cart;
            try { if (typeof original_cart === 'string') original_cart = JSON.parse(original_cart); } catch { original_cart = null; }
            return { ...row, cart, custom_rates, original_cart };
        });
        res.json(mapped);
    } catch (err) {
        console.error('Error fetching bills:', err.message || err);
        res.status(500).json({ error: 'Failed to fetch bills', detail: err.message });
    }
};

exports.getUnverifiedBills = async (req, res) => {
    const limit = parseInt(req.query.limit) || 1000;
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * limit;

    try {
        const [rows] = await db.query(`
            SELECT b.id, b.shop_id, b.invoice_no, b.shop_name, b.village_name, b.cart, b.custom_rates, 
                   b.created_by, b.bill_date, b.delivery_date, b.status, b.total_amount, b.is_edited_price, b.is_edited_qty, b.is_edited_date, 
                   b.is_applied_to_balance, b.created_at, b.original_cart, b.original_delivery_date, 
                   s.phone, s.phone2, s.order_line_id, s.owner_name as specific_area, ol.area_name,
                   COALESCE(
                       dc.old_balance, 
                       COALESCE(
                           prev.total_balance, 
                           COALESCE(
                               (
                                   SELECT tx.balance_after 
                                   FROM shop_transactions tx 
                                   WHERE tx.shop_id = b.shop_id 
                                     AND tx.transaction_date < DATE(b.delivery_date) 
                                     AND tx.approval_status = 'APPROVED'
                                   ORDER BY tx.transaction_date DESC, tx.id DESC 
                                   LIMIT 1
                               ),
                               IF(DATE(s.created_at) <= DATE(b.delivery_date), COALESCE(sb.opening_balance, 0), 0)
                           )
                       )
                   ) AS old_balance
            FROM bills b 
            LEFT JOIN shops s ON b.shop_id = s.id
            LEFT JOIN order_lines ol ON s.order_line_id = ol.id
            LEFT JOIN shop_balances sb ON b.shop_id = sb.shop_id
            LEFT JOIN daily_collections dc ON b.shop_id = dc.shop_id AND dc.collection_date = DATE(b.delivery_date)
            LEFT JOIN daily_collections prev ON b.shop_id = prev.shop_id AND prev.collection_date = (
                SELECT MAX(collection_date)
                FROM daily_collections
                WHERE shop_id = b.shop_id AND collection_date < DATE(b.delivery_date)
            )
            WHERE b.status = "Unverified" 
            ORDER BY b.delivery_date DESC, b.id DESC
            LIMIT ? OFFSET ?
        `, [limit, offset]);
        const mapped = rows.map(row => {
            let cart = row.cart;
            let custom_rates = row.custom_rates;
            try { if (typeof cart === 'string') cart = JSON.parse(cart); } catch { cart = {}; }
            try { if (typeof custom_rates === 'string') custom_rates = JSON.parse(custom_rates); } catch { custom_rates = {}; }
            let original_cart = row.original_cart;
            try { if (typeof original_cart === 'string') original_cart = JSON.parse(original_cart); } catch { original_cart = null; }
            return { ...row, cart, custom_rates, original_cart };
        });
        res.json(mapped);
    } catch (err) {
        console.error('Error fetching unverified bills:', err.message || err);
        res.status(500).json({ error: 'Failed to fetch unverified bills', detail: err.message });
    }
};

exports.verifyBill = async (req, res) => {
    const { id } = req.params;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Fetch and lock the bill details
        const [bills] = await connection.query(`
            SELECT id, shop_id, total_amount, is_applied_to_balance, created_by, status, invoice_no,
                   DATE_FORMAT(delivery_date, '%Y-%m-%d') as delivery_date_str,
                   DATE_FORMAT(bill_date, '%Y-%m-%d') as bill_date_str
            FROM bills WHERE id = ? FOR UPDATE
        `, [id]);

        if (bills.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Bill not found' });
        }
        const bill = bills[0];

        // 2. Update status to Verified
        await connection.query('UPDATE bills SET status = "Verified" WHERE id = ?', [id]);

        // 3. Determine if the bill should be applied immediately
        const [dateRows] = await connection.query("SELECT DATE_FORMAT(CONVERT_TZ(NOW(), '+00:00', '+05:30'), '%Y-%m-%d') as today");
        const todayStr = dateRows[0].today;

        const deliveryDateStr = bill.delivery_date_str || bill.bill_date_str;
        const isFutureBill = deliveryDateStr > todayStr;

        let webhookPayload = null;
        let isAppliedNow = false;
        let insertedTxId = null;

        // If today or past delivery date, and not applied yet, apply now!
        if (!isFutureBill && bill.is_applied_to_balance === 0) {
            // Lock the shop's balance row
            const [shops] = await connection.query(`
                SELECT s.id, COALESCE(sb.balance, 0) as balance, s.order_line_id, s.shop_name, s.village_name, s.owner_name as specific_area
                FROM shops s
                LEFT JOIN shop_balances sb ON s.id = sb.shop_id
                WHERE s.id = ? FOR UPDATE
            `, [bill.shop_id]);

            if (shops.length > 0) {
                const shop = shops[0];
                const amount = parseFloat(bill.total_amount) || 0;
                const balanceBefore = parseFloat(shop.balance);
                const finalBalance = balanceBefore + amount;

                // 1. Update shop_balances table
                await connection.query(
                    'INSERT INTO shop_balances (shop_id, balance) VALUES (?, ?) ON DUPLICATE KEY UPDATE balance = VALUES(balance)',
                    [shop.id, finalBalance]
                );

                // Prepare IST timestamp
                const istNow = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
                const istTimestamp = istNow.toISOString().slice(0, 19).replace('T', ' ');

                // 2. Insert into shop_transactions ledger
                const [txResult] = await connection.query(`
                    INSERT INTO shop_transactions (shop_id, type, amount, reference_id, description, balance_after, created_by, transaction_date, transaction_category)
                    VALUES (?, 'Bill', ?, ?, ?, ?, ?, ?, 'BILL')
                `, [shop.id, amount, bill.id, `Invoice #${bill.invoice_no} (Verified & Applied)`, finalBalance, bill.created_by || 'Staff', istTimestamp]);

                insertedTxId = txResult.insertId;

                // 3. Update daily_collections row for delivery date
                await connection.query(`
                    INSERT INTO daily_collections
                        (shop_id, shop_name, village_name, order_line_id, collection_date,
                         todays_bill_amount, old_balance, total_balance, future_bills, manual_adjustments)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
                    ON DUPLICATE KEY UPDATE
                        todays_bill_amount = todays_bill_amount + VALUES(todays_bill_amount),
                        total_balance = old_balance + todays_bill_amount - (cash_collected + upi_collected + cheque_collected) + manual_adjustments
                `, [shop.id, shop.shop_name, shop.village_name, shop.order_line_id,
                    deliveryDateStr, amount, balanceBefore, finalBalance]);

                // 4. Subtract from yesterday's future_bills if tracked there
                const yesterdayIST = new Date(istNow.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                await connection.query(`
                    UPDATE daily_collections
                    SET future_bills = GREATEST(0, future_bills - ?)
                    WHERE shop_id = ? AND collection_date = ?
                `, [amount, shop.id, yesterdayIST]);

                // 5. Update bill as applied
                await connection.query(
                    'UPDATE bills SET is_applied_to_balance = 1 WHERE id = ?',
                    [bill.id]
                );

                // 6. Ripple heal the ledger forward starting from deliveryDateStr
                await financialService.rebuildRipple(connection, shop.id, deliveryDateStr);

                // Fetch ripple-corrected balance_after for webhook payload accuracy
                const [correctedRows] = await connection.query(
                    'SELECT balance_after FROM shop_transactions WHERE id = ?',
                    [txResult.insertId]
                );
                const correctedBalanceAfter = correctedRows.length > 0 ? parseFloat(correctedRows[0].balance_after) : finalBalance;

                isAppliedNow = true;
                webhookPayload = {
                    shop_id: shop.id,
                    shop_name: shop.shop_name,
                    village_name: shop.village_name,
                    specific_area: shop.specific_area || '',
                    type: 'Bill',
                    amount: amount,
                    description: `Invoice #${bill.invoice_no}`,
                    balance_before: balanceBefore,
                    balance_after: correctedBalanceAfter,
                    created_by: bill.created_by || 'Staff',
                    reference_id: bill.id
                };
            }
        }

        await connection.commit();
        cacheService.flush();

        // 7. Send webhook outside transaction lock to prevent holding DB connections open
        if (webhookPayload) {
            webhookService.sendTransactionToWebhook(webhookPayload, insertedTxId);
        }

        res.json({
            message: isAppliedNow
                ? 'Bill verified and successfully applied to shop ledger and sheet'
                : 'Bill verified successfully (future-dated bill; balance will apply on delivery date)'
        });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error verifying bill:', err);
        res.status(500).json({ error: 'Failed to verify bill', detail: err.message });
    } finally {
        if (connection) connection.release();
    }
};

exports.verifyBillsBatch = async (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Invalid or empty ids array' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Fetch and lock all bill details
        const [bills] = await connection.query(`
            SELECT id, shop_id, total_amount, is_applied_to_balance, created_by, status, invoice_no,
                   DATE_FORMAT(delivery_date, '%Y-%m-%d') as delivery_date_str,
                   DATE_FORMAT(bill_date, '%Y-%m-%d') as bill_date_str
            FROM bills WHERE id IN (?) FOR UPDATE
        `, [ids]);

        if (bills.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'No bills found' });
        }

        // Get current date/today in IST
        const [dateRows] = await connection.query("SELECT DATE_FORMAT(CONVERT_TZ(NOW(), '+00:00', '+05:30'), '%Y-%m-%d') as today");
        const todayStr = dateRows[0].today;

        // Group bills by shop_id
        const billsByShop = {};
        for (const bill of bills) {
            // Only verify if not already verified
            if (bill.status !== 'Verified') {
                await connection.query('UPDATE bills SET status = "Verified" WHERE id = ?', [bill.id]);
                bill.status = 'Verified';
            }

            const deliveryDateStr = bill.delivery_date_str || bill.bill_date_str;
            const isFutureBill = deliveryDateStr > todayStr;

            // Only apply if not future date and not already applied
            if (!isFutureBill && bill.is_applied_to_balance === 0) {
                if (!billsByShop[bill.shop_id]) {
                    billsByShop[bill.shop_id] = [];
                }
                billsByShop[bill.shop_id].push({
                    bill,
                    deliveryDateStr
                });
            }
        }

        const webhooksToSend = [];

        // For each shop, process its bills
        for (const shopId of Object.keys(billsByShop)) {
            const shopBillsData = billsByShop[shopId];

            // Lock shop balance
            const [shops] = await connection.query(`
                SELECT s.id, COALESCE(sb.balance, 0) as balance, s.order_line_id, s.shop_name, s.village_name, s.owner_name as specific_area
                FROM shops s
                LEFT JOIN shop_balances sb ON s.id = sb.shop_id
                WHERE s.id = ? FOR UPDATE
            `, [shopId]);

            if (shops.length === 0) continue;
            const shop = shops[0];

            let currentBalance = parseFloat(shop.balance);
            let earliestDateStr = null;

            // Sort shop bills by deliveryDateStr (earliest first)
            shopBillsData.sort((a, b) => a.deliveryDateStr.localeCompare(b.deliveryDateStr));

            const istNow = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
            const istTimestamp = istNow.toISOString().slice(0, 19).replace('T', ' ');

            for (const { bill, deliveryDateStr } of shopBillsData) {
                const amount = parseFloat(bill.total_amount) || 0;
                const balanceBefore = currentBalance;
                const finalBalance = balanceBefore + amount;
                currentBalance = finalBalance;

                if (!earliestDateStr || deliveryDateStr < earliestDateStr) {
                    earliestDateStr = deliveryDateStr;
                }

                // 1. Insert into shop_transactions ledger
                const [txResult] = await connection.query(`
                    INSERT INTO shop_transactions (shop_id, type, amount, reference_id, description, balance_after, created_by, transaction_date, transaction_category)
                    VALUES (?, 'Bill', ?, ?, ?, ?, ?, ?, 'BILL')
                `, [shop.id, amount, bill.id, `Invoice #${bill.invoice_no} (Verified & Applied)`, finalBalance, bill.created_by || 'Staff', istTimestamp]);

                // 2. Update daily_collections row for delivery date
                await connection.query(`
                    INSERT INTO daily_collections
                        (shop_id, shop_name, village_name, order_line_id, collection_date,
                         todays_bill_amount, old_balance, total_balance, future_bills, manual_adjustments)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
                    ON DUPLICATE KEY UPDATE
                        todays_bill_amount = todays_bill_amount + VALUES(todays_bill_amount),
                        total_balance = old_balance + todays_bill_amount - (cash_collected + upi_collected + cheque_collected) + manual_adjustments
                `, [shop.id, shop.shop_name, shop.village_name, shop.order_line_id,
                    deliveryDateStr, amount, balanceBefore, finalBalance]);

                // 3. Subtract from yesterday's future_bills if tracked there
                const yesterdayIST = new Date(istNow.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                await connection.query(`
                    UPDATE daily_collections
                    SET future_bills = GREATEST(0, future_bills - ?)
                    WHERE shop_id = ? AND collection_date = ?
                `, [amount, shop.id, yesterdayIST]);

                // 4. Update bill as applied
                await connection.query(
                    'UPDATE bills SET is_applied_to_balance = 1 WHERE id = ?',
                    [bill.id]
                );

                // Queue webhook payload info (without balance_after since ripple will correct it)
                webhooksToSend.push({
                    txId: txResult.insertId,
                    payload: {
                        shop_id: shop.id,
                        shop_name: shop.shop_name,
                        village_name: shop.village_name,
                        specific_area: shop.specific_area || '',
                        type: 'Bill',
                        amount: amount,
                        description: `Invoice #${bill.invoice_no}`,
                        balance_before: balanceBefore,
                        created_by: bill.created_by || 'Staff',
                        reference_id: bill.id
                    }
                });
            }

            // Update shop_balances table with final balance for this shop
            await connection.query(
                'INSERT INTO shop_balances (shop_id, balance) VALUES (?, ?) ON DUPLICATE KEY UPDATE balance = VALUES(balance)',
                [shop.id, currentBalance]
            );

            // Rebuild ripple exactly ONCE for this shop
            if (earliestDateStr) {
                await financialService.rebuildRipple(connection, shop.id, earliestDateStr);
            }
        }

        await connection.commit();
        cacheService.flush();

        // Retrieve corrected balance_after for webhooks
        if (webhooksToSend.length > 0) {
            const txIds = webhooksToSend.map(w => w.txId);
            const [correctedRows] = await connection.query(
                'SELECT id, balance_after FROM shop_transactions WHERE id IN (?)',
                [txIds]
            );
            const correctedMap = {};
            correctedRows.forEach(r => {
                correctedMap[r.id] = parseFloat(r.balance_after);
            });

            const batchPayloads = [];
            const batchTxIds = [];
            for (const w of webhooksToSend) {
                const finalBalanceAfter = correctedMap[w.txId] !== undefined ? correctedMap[w.txId] : (w.payload.balance_before + w.payload.amount);
                batchPayloads.push({
                    ...w.payload,
                    balance_after: finalBalanceAfter
                });
                batchTxIds.push(w.txId);
            }

            // Send all payloads as a single batch and await it to prevent concurrency issues
            await webhookService.sendTransactionToWebhook(batchPayloads, batchTxIds);
        }

        res.json({
            message: `Successfully verified and processed ${bills.length} bills.`
        });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error verifying bills batch:', err);
        res.status(500).json({ error: 'Failed to verify bills batch', detail: err.message });
    } finally {
        if (connection) connection.release();
    }
};

exports.deleteBill = async (req, res) => {
    const { id } = req.params;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get bill details
        const [bills] = await connection.query(`
            SELECT shop_id, shop_name, village_name, total_amount, invoice_no, created_by, is_applied_to_balance,
            DATE_FORMAT(delivery_date, '%Y-%m-%d') as delivery_date_str, 
            DATE_FORMAT(bill_date, '%Y-%m-%d') as bill_date_str 
            FROM bills WHERE id = ?
        `, [id]);
        if (bills.length === 0) throw new Error('Bill not found');
        const bill = bills[0];

        // 1b. Get the current user's name for the ledger
        let currentUser = null;
        if (req.user && req.user.id) {
            const [users] = await connection.query('SELECT first_name, last_name FROM employees WHERE id = ?', [req.user.id]);
            currentUser = users[0];
        }
        const actingUserName = currentUser ? `${currentUser.first_name} ${currentUser.last_name || ''}`.trim() : (bill.created_by || 'Admin');

        // 2. Get shop details (Try ID first, then fallback to name for legacy bills)
        let [shops] = await connection.query(`
            SELECT s.id, COALESCE(sb.balance, 0) as balance, s.shop_name, s.village_name, s.order_line_id, s.owner_name as specific_area 
            FROM shops s
            LEFT JOIN shop_balances sb ON s.id = sb.shop_id
            WHERE s.id = ? FOR UPDATE
        `, [bill.shop_id]);
        
        if (shops.length === 0) {
            [shops] = await connection.query(`
                SELECT s.id, COALESCE(sb.balance, 0) as balance, s.shop_name, s.village_name, s.order_line_id, s.owner_name as specific_area 
                FROM shops s
                LEFT JOIN shop_balances sb ON s.id = sb.shop_id
                WHERE TRIM(s.shop_name) = TRIM(?) AND TRIM(s.village_name) = TRIM(?) FOR UPDATE
            `, [bill.shop_name, bill.village_name]);
        }

        if (shops.length > 0) {
            const shop = shops[0];
            const amount = parseFloat(bill.total_amount);
            
            // Only reverse balance if it was already applied
            if (bill.is_applied_to_balance) {
                // DELETE the original transaction to fully wipe it from the ledger, preventing
                // rebuildRipple from re-aggregating it into 'todays_bill_amount'.
                await connection.query(
                    'DELETE FROM shop_transactions WHERE shop_id = ? AND reference_id = ? AND type = ?',
                    [shop.id, id, 'Bill']
                );
            }

            // 5. Push to Webhook (Only if the bill was actually applied to the balance)
            if (bill.is_applied_to_balance) {
                webhookService.sendTransactionToWebhook({
                    shop_id: shop.id,
                    shop_name: bill.shop_name,
                    village_name: bill.village_name,
                    specific_area: shop.specific_area || '',
                    type: 'Cancellation',
                    amount: -amount,
                    description: `Cancelled Invoice #${bill.invoice_no}`,
                    balance_before: parseFloat(shop.balance),
                    balance_after: parseFloat(shop.balance) - amount,
                    created_by: actingUserName,
                    ref_id: `INV-${bill.invoice_no}`
                });
            }

            // 5b. Reverse from daily_collections
            const delDateStr = bill.delivery_date_str || bill.bill_date_str;
            const [todayRows] = await connection.query("SELECT DATE_FORMAT(CONVERT_TZ(NOW(), '+00:00', '+05:30'), '%Y-%m-%d') as today");
            const todayStr = todayRows[0].today;
            const isFutureBill = delDateStr > todayStr;

            if (isFutureBill) {
                // Future bill deleted: remove from delivery date row and subtract from today's future_bills
                await connection.query(`
                    UPDATE daily_collections
                    SET todays_bill_amount = GREATEST(0, todays_bill_amount - ?),
                        total_balance = old_balance + GREATEST(0, todays_bill_amount - ?) - (cash_collected + upi_collected + cheque_collected) + manual_adjustments
                    WHERE shop_id = ? AND collection_date = ?
                `, [amount, amount, shop.id, delDateStr]);

                // Reduce today's future_bills column — total_balance is NOT affected
                // Use INSERT ... ON DUPLICATE KEY UPDATE to guarantee the row exists
                // (if no collection activity happened today yet, the UPDATE alone would silently do nothing)
                await connection.query(`
                    INSERT INTO daily_collections
                        (shop_id, shop_name, village_name, order_line_id, collection_date,
                         future_bills, old_balance, total_balance)
                    VALUES (?, ?, ?, ?, ?, 0, 0, 0)
                    ON DUPLICATE KEY UPDATE
                        future_bills = GREATEST(0, future_bills - ?)
                `, [shop.id, bill.shop_name, bill.village_name, shop.order_line_id, todayStr, amount]);
            } else {
                // Today's or past bill deleted: remove from its date row
                await connection.query(`
                    UPDATE daily_collections
                    SET todays_bill_amount = GREATEST(0, todays_bill_amount - ?),
                        total_balance = GREATEST(0, total_balance - ?)
                    WHERE shop_id = ? AND collection_date = ?
                `, [amount, amount, shop.id, delDateStr]);

                // MASTER SYNC: Heal the ledger starting from the delivery date
                if (bill.is_applied_to_balance) {
                    await financialService.rebuildRipple(connection, shop.id, delDateStr);
                }
            }
        }

        // 6. Delete the bill
        await connection.query('DELETE FROM bills WHERE id = ?', [id]);

        await connection.commit();
        cacheService.flush();
        res.json({ message: 'Bill deleted and balance reversed successfully' });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error deleting bill:', err);
        res.status(500).json({ error: 'Failed to delete bill' });
    } finally {
        if (connection) connection.release();
    }
};

exports.updateBill = async (req, res) => {
    const { id } = req.params;
    const { cart, custom_rates, total_amount, is_edited_price, is_edited_qty, is_edited_date } = req.body;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get old bill details
        const [bills] = await connection.query(`
            SELECT shop_id, shop_name, village_name, total_amount, invoice_no, created_by,
            is_applied_to_balance,
            delivery_date,
            DATE_FORMAT(delivery_date, '%Y-%m-%d') as delivery_date_str, 
            DATE_FORMAT(bill_date, '%Y-%m-%d') as bill_date_str,
            cart, custom_rates, is_edited_price, is_edited_qty, is_edited_date 
            FROM bills WHERE id = ? FOR UPDATE
        `, [id]);
        if (bills.length === 0) throw new Error('Bill not found');
        const bill = bills[0];

        // 1b. Get current user's name for the ledger
        let currentUser = null;
        if (req.user && req.user.id) {
            const [users] = await connection.query('SELECT first_name, last_name FROM employees WHERE id = ?', [req.user.id]);
            currentUser = users[0];
        }
        const actingUserName = currentUser ? `${currentUser.first_name} ${currentUser.last_name || ''}`.trim() : (req.body.created_by || bill.created_by || 'Admin');

        // 2. Fetch DB rates and calculate secure ground-truth difference
        const [dbRatesRows] = await connection.query('SELECT product_id, rate FROM product_rates');
        const dbRates = {};
        dbRatesRows.forEach(row => {
            dbRates[row.product_id] = parseFloat(row.rate);
        });

        // Resolve the cart and custom rates that will be saved after this edit
        let finalCart = bill.cart;
        if (cart !== undefined) {
            finalCart = typeof cart === 'string' ? JSON.parse(cart) : cart;
        } else {
            try { if (typeof finalCart === 'string') finalCart = JSON.parse(finalCart); } catch (e) { finalCart = {}; }
        }

        let finalCustomRates = bill.custom_rates;
        if (custom_rates !== undefined) {
            finalCustomRates = typeof custom_rates === 'string' ? JSON.parse(custom_rates) : custom_rates;
        } else {
            try { if (typeof finalCustomRates === 'string') finalCustomRates = JSON.parse(finalCustomRates); } catch (e) { finalCustomRates = {}; }
        }

        const computedAmount = recalculateTotalAmount(finalCart, finalCustomRates, dbRates);

        const oldAmount = parseFloat(bill.total_amount);
        const newAmount = computedAmount;
        const diff = newAmount - oldAmount;

        if (total_amount !== undefined && Math.abs(computedAmount - parseFloat(total_amount)) > 1.0) {
            console.warn(`[SECURITY WARNING] Mismatch in total_amount for Shop #${bill.shop_id} during edit. Client sent: ${total_amount}, Computed: ${computedAmount}. Enforcing computed total.`);
        }

        // 6. Delivery Date Handling
        let mysqlDeliveryDate = bill.delivery_date 
            ? new Date(new Date(bill.delivery_date).getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ') 
            : (bill.bill_date_str ? bill.bill_date_str + ' 00:00:00' : new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' '));
        
        if (req.body.delivery_date) {
            try {
                const d = new Date(req.body.delivery_date);
                if (!isNaN(d.getTime())) {
                    const istD = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
                    mysqlDeliveryDate = istD.toISOString().slice(0, 19).replace('T', ' ');
                }
            } catch (e) { }
        }

        if (!mysqlDeliveryDate) {
            mysqlDeliveryDate = bill.bill_date_str ? bill.bill_date_str + ' 00:00:00' : new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
        }

        // 6b. Update daily_collections
        // Fetch shop details for collections (needed for order_line_id)
        // 3. Get shop details (Try ID first, then fallback to name for legacy bills)
        let [collShops] = await connection.query(`
            SELECT s.id, COALESCE(sb.balance, 0) as balance, s.order_line_id,
                   s.shop_name, s.village_name, s.owner_name as specific_area
            FROM shops s
            LEFT JOIN shop_balances sb ON s.id = sb.shop_id
            WHERE s.id = ? FOR UPDATE
        `, [bill.shop_id]);
        if (collShops.length === 0) {
            [collShops] = await connection.query(`
                SELECT s.id, COALESCE(sb.balance, 0) as balance, s.order_line_id,
                       s.shop_name, s.village_name, s.owner_name as specific_area
                FROM shops s
                LEFT JOIN shop_balances sb ON s.id = sb.shop_id
                WHERE TRIM(s.shop_name) = TRIM(?) AND TRIM(s.village_name) = TRIM(?) FOR UPDATE
            `, [bill.shop_name, bill.village_name]);
        }
        const collShop = collShops[0];
        // Capture BEFORE any modifications — this is the true pre-edit balance for the Sheet
        const balanceBefore = collShop ? parseFloat(collShop.balance) : 0;

        if (collShop) {
            const oldDateStr = bill.delivery_date_str || bill.bill_date_str;
            const newDateStr = mysqlDeliveryDate ? mysqlDeliveryDate.split(' ')[0] : bill.bill_date_str;
            const [todayDateRows] = await connection.query("SELECT DATE_FORMAT(CONVERT_TZ(NOW(), '+00:00', '+05:30'), '%Y-%m-%d') as today");
            const todayStrUpd = todayDateRows[0].today;

            const isFutureNew = newDateStr > todayStrUpd;
            // is_applied_to_balance = 0 means bill was deferred (future), 1 means already applied
            const isOldFuture = bill.is_applied_to_balance === 0;
            const isEditedPriceFinal = is_edited_price !== undefined ? (is_edited_price ? 1 : 0) : (bill.is_edited_price || 0);
            const isEditedQtyFinal = is_edited_qty !== undefined ? (is_edited_qty ? 1 : 0) : (bill.is_edited_qty || 0);
            const isEditedDateFinal = is_edited_date !== undefined ? (is_edited_date ? 1 : 0) : (bill.is_edited_date || 0);

            // ── UPDATE BILLS TABLE FIRST ──
            // rebuildRipple queries bills WHERE is_applied_to_balance = 0 for future_bills.
            // Updating bills BEFORE rebuildRipple ensures it sees the correct delivery_date and amount.
            await connection.query(
                'UPDATE bills SET cart=?, custom_rates=?, total_amount=?, delivery_date=?, is_edited_price=?, is_edited_qty=?, is_edited_date=?, is_applied_to_balance=? WHERE id=?',
                [
                    JSON.stringify(finalCart),
                    JSON.stringify(finalCustomRates),
                    newAmount, mysqlDeliveryDate, isEditedPriceFinal, isEditedQtyFinal, isEditedDateFinal,
                    isFutureNew ? 0 : 1, id
                ]
            );

            if (!isOldFuture && isFutureNew) {
                // ── SCENARIO 2: Past/Today → Future ──
                // Bill moves to future: remove its ledger tx (future bills have no tx; cron applies on delivery day).
                await connection.query(
                    `DELETE FROM shop_transactions WHERE shop_id = ? AND reference_id = ? AND type = 'Bill'`,
                    [collShop.id, id]
                );
                // Add to today's future_bills column
                await connection.query(`
                    INSERT INTO daily_collections
                        (shop_id, shop_name, village_name, order_line_id, collection_date,
                         future_bills, old_balance, total_balance, manual_adjustments)
                    VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0)
                    ON DUPLICATE KEY UPDATE future_bills = future_bills + VALUES(future_bills)
                `, [collShop.id, collShop.shop_name, collShop.village_name, collShop.order_line_id, todayStrUpd, newAmount]);

                // Ripple recalculation starting from the old delivery date to remove its balance impact
                await financialService.rebuildRipple(connection, collShop.id, oldDateStr);

            } else if (isOldFuture && !isFutureNew) {
                // ── SCENARIO 3: Future → Past/Today ──
                // Applying a deferred bill now: INSERT its ledger tx (rebuildRipple will fix balance_after).
                await connection.query(
                    `INSERT INTO shop_transactions
                         (shop_id, type, amount, reference_id, description, balance_after, transaction_date, created_by, transaction_category)
                     VALUES (?, 'Bill', ?, ?, ?, 0, ?, ?, 'BILL')`,
                    [collShop.id, newAmount, id, `Invoice #${bill.invoice_no}`, newDateStr, actingUserName]
                );
                // Remove from today's future_bills column
                await connection.query(
                    'UPDATE daily_collections SET future_bills = GREATEST(0, future_bills - ?) WHERE shop_id = ? AND collection_date = ?',
                    [oldAmount, collShop.id, todayStrUpd]
                );

                // Ripple recalculation starting from the new delivery date to apply its balance impact
                await financialService.rebuildRipple(connection, collShop.id, newDateStr);

            } else if (!isOldFuture && !isFutureNew) {
                // ── SCENARIO 1: Past/Today → Past/Today ──
                if (oldDateStr !== newDateStr) {
                    // Both applied: move shop_transaction to new date so rebuildRipple aggregates correctly.
                    await connection.query(
                        `UPDATE shop_transactions SET transaction_date = ?, description = ?, amount = ?
                         WHERE shop_id = ? AND reference_id = ? AND type = 'Bill'`,
                        [newDateStr, `Invoice #${bill.invoice_no} (Date Edited)`, newAmount, collShop.id, id]
                    );

                    // MASTER SYNC from the earliest affected date
                    const earliestDate = oldDateStr < newDateStr ? oldDateStr : newDateStr;
                    await financialService.rebuildRipple(connection, collShop.id, earliestDate);
                } else if (diff !== 0) {
                    // Same date, amount changed: update shop_transaction amount
                    await connection.query(
                        `UPDATE shop_transactions SET amount = ?, description = ?
                         WHERE shop_id = ? AND reference_id = ? AND type = 'Bill'`,
                        [newAmount, `Invoice #${bill.invoice_no} (Edited)`, collShop.id, id]
                    );
                    await financialService.rebuildRipple(connection, collShop.id, newDateStr);
                }
            } else {
                // ── SCENARIO 4: Future → Future ──
                // No shop_transaction exists for either date.
                // rebuildRipple recalculates future_bills from the updated bills table.
                if (oldDateStr !== newDateStr || diff !== 0) {
                    // Ensure daily_collections row exists for new date so rebuildRipple can update it
                    await connection.query(`
                        INSERT IGNORE INTO daily_collections
                            (shop_id, shop_name, village_name, order_line_id, collection_date,
                             todays_bill_amount, old_balance, total_balance, future_bills, manual_adjustments)
                        VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0)
                    `, [collShop.id, collShop.shop_name, collShop.village_name, collShop.order_line_id, newDateStr]);

                    // MASTER SYNC from the earliest affected date
                    const earliestDate = oldDateStr < newDateStr ? oldDateStr : newDateStr;
                    await financialService.rebuildRipple(connection, collShop.id, earliestDate);
                }
            }

            // ── COMPREHENSIVE WEBHOOK: Sent after all DB work, covering every edit type ──
            // Captures the final balance after rebuildRipple has recalculated everything.
            if (oldDateStr !== newDateStr || diff !== 0 || isOldFuture !== isFutureNew) {
                const [finalBalRow] = await connection.query(
                    'SELECT COALESCE(balance, 0) as balance FROM shop_balances WHERE shop_id = ?',
                    [collShop.id]
                );
                const finalBalance = finalBalRow.length > 0 ? parseFloat(finalBalRow[0].balance) : 0;

                // Scenario 1: Applied → Applied (Both old and new were active/applied)
                if (!isOldFuture && !isFutureNew) {
                    const changes = [];
                    if (diff !== 0) changes.push(`Amount: ₹${oldAmount} → ₹${newAmount}`);
                    if (oldDateStr !== newDateStr) changes.push(`Date: ${oldDateStr} → ${newDateStr}`);

                    webhookService.sendTransactionToWebhook({
                        shop_id:        collShop.id,
                        shop_name:      collShop.shop_name,
                        village_name:   collShop.village_name,
                        specific_area:  collShop.specific_area || '',    // Column E
                        type:           'Bill Edit',                     // Column B
                        amount:         newAmount,                       // Column F — new total
                        payment_method: 'Edit',                          // Column G
                        description:    `Invoice #${bill.invoice_no}: ${changes.join(', ')}`, // Column H
                        balance_before: balanceBefore,                   // Column I — true pre-edit balance
                        balance_after:  finalBalance,                     // Column J — accurate post-ripple balance
                        created_by:     actingUserName,                  // Column K
                        ref_id:         `INV-${bill.invoice_no}`         // Column L
                    });
                }
                // Scenario 2: Applied → Future (Was active, now deferred to future delivery)
                else if (!isOldFuture && isFutureNew) {
                    webhookService.sendTransactionToWebhook({
                        shop_id:        collShop.id,
                        shop_name:      collShop.shop_name,
                        village_name:   collShop.village_name,
                        specific_area:  collShop.specific_area || '',
                        type:           'Cancellation',
                        amount:         -oldAmount,
                        description:    `Deferred Invoice #${bill.invoice_no} (Moved to Future)`,
                        balance_before: balanceBefore,
                        balance_after:  finalBalance,
                        created_by:     actingUserName,
                        ref_id:         `INV-${bill.invoice_no}`
                    });
                }
                // Scenario 3: Future → Applied (Was deferred, now active/due today or past)
                else if (isOldFuture && !isFutureNew) {
                    webhookService.sendTransactionToWebhook({
                        shop_id:        collShop.id,
                        shop_name:      collShop.shop_name,
                        village_name:   collShop.village_name,
                        specific_area:  collShop.specific_area || '',
                        type:           'Bill',
                        amount:         newAmount,
                        description:    `Invoice #${bill.invoice_no} Applied`,
                        balance_before: balanceBefore,
                        balance_after:  finalBalance,
                        created_by:     actingUserName,
                        ref_id:         `INV-${bill.invoice_no}`
                    });
                }
                // Scenario 4: Future → Future (Remains deferred/future-dated)
                // - No webhook is sent because the bill was never on the active ledger.
            }
        }

        await connection.commit();
        cacheService.flush();
        res.json({ message: 'Bill updated and balance adjusted successfully' });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Error updating bill:', err);
        res.status(500).json({ error: 'Failed to update bill' });
    } finally {
        if (connection) connection.release();
    }
};

exports.getBillsByDateRange = async (req, res) => {
    const { startDate, endDate } = req.query;
    const limit = parseInt(req.query.limit) || 1000;
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * limit;

    try {
        let query = `
            SELECT b.id, b.shop_id, b.invoice_no, b.shop_name, b.village_name, b.cart, b.custom_rates, 
                   b.created_by, b.bill_date, b.delivery_date, b.status, b.total_amount, b.is_edited_price, b.is_edited_qty, b.is_edited_date, 
                   b.is_applied_to_balance, b.created_at, b.original_cart, b.original_delivery_date,
                   s.phone, s.phone2, s.order_line_id, s.owner_name as specific_area, ol.area_name,
                   COALESCE(
                       dc.old_balance, 
                       COALESCE(
                           prev.total_balance, 
                           COALESCE(
                               (
                                   SELECT tx.balance_after 
                                   FROM shop_transactions tx 
                                   WHERE tx.shop_id = b.shop_id 
                                     AND tx.transaction_date < DATE(b.delivery_date) 
                                     AND tx.approval_status = 'APPROVED'
                                   ORDER BY tx.transaction_date DESC, tx.id DESC 
                                   LIMIT 1
                               ),
                               IF(DATE(s.created_at) <= DATE(b.delivery_date), COALESCE(sb.opening_balance, 0), 0)
                           )
                       )
                   ) AS old_balance
            FROM bills b 
            LEFT JOIN shops s ON b.shop_id = s.id 
            LEFT JOIN order_lines ol ON s.order_line_id = ol.id
            LEFT JOIN shop_balances sb ON b.shop_id = sb.shop_id
            LEFT JOIN daily_collections dc ON b.shop_id = dc.shop_id AND dc.collection_date = DATE(b.delivery_date)
            LEFT JOIN daily_collections prev ON b.shop_id = prev.shop_id AND prev.collection_date = (
                SELECT MAX(collection_date)
                FROM daily_collections
                WHERE shop_id = b.shop_id AND collection_date < DATE(b.delivery_date)
            )
            WHERE b.status = "Verified"
        `;
        const params = [];

        if (startDate) {
            query += ' AND b.delivery_date >= ?';
            params.push(startDate);
        }
        if (endDate) {
            // Add 1 day to endDate to include the full end day
            const end = new Date(endDate);
            end.setDate(end.getDate() + 1);
            query += ' AND b.delivery_date < ?';
            params.push(end.toISOString().split('T')[0]);
        }

        query += ' ORDER BY b.delivery_date DESC, b.id DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const [rows] = await db.query(query, params);
        const mapped = rows.map(row => {
            let cart = row.cart;
            let custom_rates = row.custom_rates;
            try { if (typeof cart === 'string') cart = JSON.parse(cart); } catch { cart = {}; }
            try { if (typeof custom_rates === 'string') custom_rates = JSON.parse(custom_rates); } catch { custom_rates = {}; }
            let original_cart = row.original_cart;
            try { if (typeof original_cart === 'string') original_cart = JSON.parse(original_cart); } catch { original_cart = null; }
            return { ...row, cart, custom_rates, original_cart };
        });
        res.json(mapped);
    } catch (err) {
        console.error('Error fetching bills by date range:', err.message || err);
        res.status(500).json({ error: 'Failed to fetch bills by date range', detail: err.message });
    }
};

exports.getBillsCount = async (req, res) => {
    try {
        const [rows] = await db.query('SELECT COUNT(*) as count FROM bills WHERE status = "Verified"');
        res.json({ count: rows[0].count });
    } catch (err) {
        console.error('Error fetching bills count:', err.message || err);
        res.status(500).json({ error: 'Failed to fetch bills count', detail: err.message });
    }
};

// Legacy local recalculateShopLedger removed in favor of financialService.rebuildRipple

