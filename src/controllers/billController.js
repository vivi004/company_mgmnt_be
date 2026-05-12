const db = require('../config/db');
const webhookService = require('../services/webhookService');

exports.createBill = async (req, res) => {
    const { shop_id, phone, cart, custom_rates, bill_date, status, total_amount, delivery_date, is_edited_price } = req.body;
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
            const [rows] = await connection.query('SELECT id, balance, order_line_id, shop_name, village_name, owner_name as specific_area FROM shops WHERE id = ? FOR UPDATE', [shop_id]);
            if (rows.length > 0) shop = rows[0];
        }

        if (!shop) {
            let [shops] = await connection.query(
                'SELECT id, balance, order_line_id, shop_name, village_name FROM shops WHERE TRIM(shop_name) = TRIM(?) AND TRIM(village_name) = TRIM(?) FOR UPDATE',
                [shop_name, village_name]
            );

            if (shops.length === 0) {
                // AUTO-CREATE SHOP for "Temporary" / New Shop billing
                console.log(`Shop "${shop_name}" not found. Auto-creating for temporary billing...`);
                
                // First, find or create the village (order_line)
                let [orderLines] = await connection.query('SELECT id FROM order_lines WHERE TRIM(name) = TRIM(?)', [village_name]);
                let orderLineId;
                
                if (orderLines.length > 0) {
                    orderLineId = orderLines[0].id;
                } else {
                    // Create new village if it doesn't exist
                    const nodeId = `TEMP-${Date.now()}`;
                    const [olResult] = await connection.query(
                        'INSERT INTO order_lines (name, node_id) VALUES (?, ?)',
                        [village_name, nodeId]
                    );
                    orderLineId = olResult.insertId;
                }

                // Create the new shop
                const [shopResult] = await connection.query(
                    'INSERT INTO shops (order_line_id, shop_name, village_name, phone, balance) VALUES (?, ?, ?, ?, ?)',
                    [orderLineId, shop_name, village_name, phone || '', 0]
                );
                
                shop = { id: shopResult.insertId, balance: 0, order_line_id: orderLineId, shop_name, village_name, specific_area: '' };

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
                mysqlDeliveryDate = null;
            }
        }

        // 5. Handle Balance Application (Deferred if delivery date is in the future)
        const cartJson = typeof cart === 'string' ? cart : JSON.stringify(cart);
        const ratesJson = typeof custom_rates === 'string' ? custom_rates : JSON.stringify(custom_rates || {});
        const amount = parseFloat(total_amount) || 0;

        const [dateRows] = await connection.query("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d') as today");
        const todayStr = dateRows[0].today;
        const deliveryDateOnly = mysqlDeliveryDate ? mysqlDeliveryDate.split(' ')[0] : todayStr;
        const shouldApplyNow = deliveryDateOnly <= todayStr;

        let finalBalance = parseFloat(shop.balance);
        if (shouldApplyNow) {
            finalBalance += amount;
            await connection.query('UPDATE shops SET balance = ? WHERE id = ?', [finalBalance, shop.id]);
        }
        
        const [billResult] = await connection.query(
            'INSERT INTO bills (shop_id, invoice_no, shop_name, village_name, cart, custom_rates, created_by, bill_date, delivery_date, status, total_amount, is_edited_price, is_applied_to_balance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [shop.id, String(assignedInvoiceNo), shop.shop_name, shop.village_name, cartJson, ratesJson, created_by || 'Staff', mysqlDate, mysqlDeliveryDate, status || 'Unverified', amount, is_edited_price ? 1 : 0, shouldApplyNow ? 1 : 0]
        );

        // 7. Create Shop Transaction (Ledger Entry)
        await connection.query(
            'INSERT INTO shop_transactions (shop_id, type, amount, reference_id, description, balance_after, created_by, transaction_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [shop.id, 'Bill', amount, billResult.insertId, `Invoice #${assignedInvoiceNo}${shouldApplyNow ? '' : ' (Deferred)'}`, finalBalance, created_by || 'Staff', mysqlDate]
        );

        // 8. Increment the next invoice number
        await connection.query(
            'UPDATE app_settings SET next_invoice_no = next_invoice_no + 1, last_invoice_no = ? WHERE id = 1',
            [assignedInvoiceNo]
        );

        // 8b. Update daily_collections
        const rawCollDate = mysqlDeliveryDate || mysqlDate;
        const collectionDateStr = rawCollDate.split(' ')[0];
        const shopOrderLineId = shop.order_line_id;

        await connection.query(`
            INSERT INTO daily_collections 
                (shop_id, shop_name, village_name, order_line_id, collection_date, 
                 todays_bill_amount, old_balance, total_balance)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
                todays_bill_amount = todays_bill_amount + VALUES(todays_bill_amount),
                total_balance = VALUES(total_balance)
        `, [shop.id, shop.shop_name, shop.village_name, shopOrderLineId, collectionDateStr, 
            amount, parseFloat(shop.balance), parseFloat(shop.balance) + amount]);

        await connection.commit();

        // 9. Push to Webhook (Background)
        webhookService.sendTransactionToWebhook({
            shop_id: shop.id,
            shop_name: shop.shop_name,
            village_name: shop.village_name,
            specific_area: shop.specific_area || '',
            type: 'Bill',
            amount: amount,
            description: `Invoice #${assignedInvoiceNo}${shouldApplyNow ? '' : ' (Deferred)'}`,
            balance_before: shop.balance,
            balance_after: finalBalance,
            created_by: created_by || 'Staff',
            reference_id: billResult.insertId
        });

        res.status(201).json({
            message: 'Bill created successfully',
            id: billResult.insertId,
            invoice_no: assignedInvoiceNo,
            new_balance: finalBalance
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
    try {
        // Primary ledger = only verified bills
        const [rows] = await db.query(`
            SELECT b.*, s.phone, s.phone2, s.order_line_id, s.owner_name as specific_area, ol.area_name
            FROM bills b 
            LEFT JOIN shops s ON b.shop_id = s.id
            LEFT JOIN order_lines ol ON s.order_line_id = ol.id
            WHERE b.status = "Verified" 
            ORDER BY COALESCE(b.delivery_date, b.bill_date) DESC, b.id DESC
        `);
        const mapped = rows.map(row => {
            let cart = row.cart;
            let custom_rates = row.custom_rates;
            try { if (typeof cart === 'string') cart = JSON.parse(cart); } catch { cart = {}; }
            try { if (typeof custom_rates === 'string') custom_rates = JSON.parse(custom_rates); } catch { custom_rates = {}; }
            return { ...row, cart, custom_rates };
        });
        res.json(mapped);
    } catch (err) {
        console.error('Error fetching bills:', err.message || err);
        res.status(500).json({ error: 'Failed to fetch bills', detail: err.message });
    }
};

exports.getUnverifiedBills = async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT b.*, s.phone, s.phone2, s.order_line_id, s.owner_name as specific_area, ol.area_name
            FROM bills b 
            LEFT JOIN shops s ON b.shop_id = s.id
            LEFT JOIN order_lines ol ON s.order_line_id = ol.id
            WHERE b.status = "Unverified" 
            ORDER BY COALESCE(b.delivery_date, b.bill_date) DESC, b.id DESC
        `);
        const mapped = rows.map(row => {
            let cart = row.cart;
            let custom_rates = row.custom_rates;
            try { if (typeof cart === 'string') cart = JSON.parse(cart); } catch { cart = {}; }
            try { if (typeof custom_rates === 'string') custom_rates = JSON.parse(custom_rates); } catch { custom_rates = {}; }
            return { ...row, cart, custom_rates };
        });
        res.json(mapped);
    } catch (err) {
        console.error('Error fetching unverified bills:', err.message || err);
        res.status(500).json({ error: 'Failed to fetch unverified bills', detail: err.message });
    }
};

exports.verifyBill = async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('UPDATE bills SET status = "Verified" WHERE id = ?', [id]);
        res.json({ message: 'Bill verified successfully' });
    } catch (err) {
        console.error('Error verifying bill:', err);
        res.status(500).json({ error: 'Failed to verify bill' });
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
        let [shops] = await connection.query('SELECT id, balance, shop_name, village_name, order_line_id FROM shops WHERE id = ? FOR UPDATE', [bill.shop_id]);
        if (shops.length === 0) {
            [shops] = await connection.query(
                'SELECT id, balance, shop_name, village_name, order_line_id FROM shops WHERE TRIM(shop_name) = TRIM(?) AND TRIM(village_name) = TRIM(?) FOR UPDATE',
                [bill.shop_name, bill.village_name]
            );
        }

        if (shops.length > 0) {
            const shop = shops[0];
            const amount = parseFloat(bill.total_amount);
            
            // Only reverse balance if it was already applied
            let newBalance = parseFloat(shop.balance);
            if (bill.is_applied_to_balance) {
                newBalance -= amount;
                await connection.query('UPDATE shops SET balance = ? WHERE id = ?', [newBalance, shop.id]);
                
                // 4. Create "Cancellation" Ledger Entry
                await connection.query(
                    'INSERT INTO shop_transactions (shop_id, type, amount, reference_id, description, balance_after, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [shop.id, 'Adjustment', -amount, id, `Cancelled Invoice #${bill.invoice_no}`, newBalance, actingUserName]
                );
            }

            // 5. Push to Webhook
            webhookService.sendTransactionToWebhook({
                shop_id: shop.id,
                shop_name: bill.shop_name,
                village_name: bill.village_name,
                type: 'Cancellation',
                amount: -amount,
                description: `Cancelled Invoice #${bill.invoice_no}`,
                balance_before: parseFloat(shop.balance),
                balance_after: newBalance,
                created_by: actingUserName
            });

            // 5b. Reverse from daily_collections
            const delDateStr = bill.delivery_date_str || bill.bill_date_str;
            
            await connection.query(`
                UPDATE daily_collections
                SET todays_bill_amount = todays_bill_amount - ?,
                    total_balance = total_balance - ?
                WHERE shop_id = ? AND collection_date = ?
            `, [amount, amount, shop.id, delDateStr]);
        }

        // 6. Delete the bill
        await connection.query('DELETE FROM bills WHERE id = ?', [id]);

        await connection.commit();
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
    const { cart, custom_rates, total_amount, is_edited_price } = req.body;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get old bill details
        const [bills] = await connection.query(`
            SELECT shop_id, shop_name, village_name, total_amount, invoice_no, created_by, 
            DATE_FORMAT(delivery_date, '%Y-%m-%d') as delivery_date_str, 
            DATE_FORMAT(bill_date, '%Y-%m-%d') as bill_date_str,
            cart, custom_rates, is_edited_price 
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

        // 2. Calculate difference
        const oldAmount = parseFloat(bill.total_amount);
        const newAmount = total_amount !== undefined ? parseFloat(total_amount) : oldAmount;
        const diff = newAmount - oldAmount;

        // 3. Update shop balance if there's a difference
        let shopId = null;
        if (diff !== 0) {
            const [shops] = await connection.query(
                'SELECT id, balance FROM shops WHERE TRIM(shop_name) = TRIM(?) AND TRIM(village_name) = TRIM(?) FOR UPDATE', 
                [bill.shop_name, bill.village_name]
            );
            if (shops.length > 0) {
                const shop = shops[0];
                shopId = shop.id;
                const newBalance = parseFloat(shop.balance) + diff;
                await connection.query('UPDATE shops SET balance = ? WHERE id = ?', [newBalance, shop.id]);

                // 4. Create Ledger Entry for adjustment
                await connection.query(
                    'INSERT INTO shop_transactions (shop_id, type, amount, reference_id, description, balance_after, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [shop.id, 'Adjustment', diff, id, `Update Invoice #${bill.invoice_no}`, newBalance, actingUserName]
                );

                // 5. Push to Webhook
                webhookService.sendTransactionToWebhook({
                    shop_id: shop.id,
                    shop_name: bill.shop_name,
                    village_name: bill.village_name,
                    type: 'Adjustment',
                    amount: diff,
                    description: `Update Invoice #${bill.invoice_no}`,
                    balance_before: parseFloat(shop.balance),
                    balance_after: newBalance,
                    created_by: actingUserName
                });
            }
        }

        // 6. Delivery Date Handling
        let mysqlDeliveryDate = bill.delivery_date ? new Date(new Date(bill.delivery_date).getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ') : null;
        if (req.body.delivery_date) {
            try {
                const d = new Date(req.body.delivery_date);
                if (!isNaN(d.getTime())) {
                    const istD = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
                    mysqlDeliveryDate = istD.toISOString().slice(0, 19).replace('T', ' ');
                }
            } catch (e) { }
        }

        // 6b. Update daily_collections
        // Fetch shop details for collections (needed for order_line_id)
        // 3. Get shop details (Try ID first, then fallback to name for legacy bills)
        let [collShops] = await connection.query('SELECT id, balance, order_line_id, shop_name, village_name FROM shops WHERE id = ? FOR UPDATE', [bill.shop_id]);
        if (collShops.length === 0) {
            [collShops] = await connection.query(
                'SELECT id, balance, order_line_id, shop_name, village_name FROM shops WHERE TRIM(shop_name) = TRIM(?) AND TRIM(village_name) = TRIM(?) FOR UPDATE',
                [bill.shop_name, bill.village_name]
            );
        }
        const collShop = collShops[0];

        if (collShop) {
            const oldDateStr = bill.delivery_date_str || bill.bill_date_str;
            const newDateStr = mysqlDeliveryDate ? mysqlDeliveryDate.split(' ')[0] : bill.bill_date_str;

            if (oldDateStr !== newDateStr) {
                // Date changed: Move amount from old date to new date
                await connection.query(`
                    UPDATE daily_collections
                    SET todays_bill_amount = todays_bill_amount - ?,
                        total_balance = total_balance - ?
                    WHERE shop_id = ? AND collection_date = ?
                `, [oldAmount, oldAmount, collShop.id, oldDateStr]);

                await connection.query(`
                    INSERT INTO daily_collections
                        (shop_id, shop_name, village_name, order_line_id, collection_date,
                         todays_bill_amount, old_balance, total_balance)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        todays_bill_amount = todays_bill_amount + VALUES(todays_bill_amount),
                        total_balance = VALUES(total_balance)
                `, [collShop.id, collShop.shop_name, collShop.village_name, collShop.order_line_id, newDateStr,
                    newAmount, parseFloat(collShop.balance), parseFloat(collShop.balance) + newAmount]);
            } else if (diff !== 0) {
                // Same date, just update difference
                const finalBalance = parseFloat(collShop.balance) + diff;
                await connection.query(`
                    UPDATE daily_collections
                    SET todays_bill_amount = todays_bill_amount + ?,
                        total_balance = ?
                    WHERE shop_id = ? AND collection_date = ?
                `, [diff, finalBalance, collShop.id, newDateStr]);
            }
        }

        await connection.query(
            'UPDATE bills SET cart = ?, custom_rates = ?, total_amount = ?, delivery_date = ?, is_edited_price = ? WHERE id = ?',
            [
                JSON.stringify(cart !== undefined ? cart : bill.cart), 
                JSON.stringify(custom_rates !== undefined ? custom_rates : bill.custom_rates), 
                newAmount, 
                mysqlDeliveryDate, 
                is_edited_price !== undefined ? (is_edited_price ? 1 : 0) : bill.is_edited_price,
                id
            ]
        );

        await connection.commit();
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
    try {
        let query = `
            SELECT b.*, s.phone, s.phone2, s.order_line_id, s.owner_name as specific_area, ol.area_name
            FROM bills b 
            LEFT JOIN shops s ON b.shop_id = s.id 
            LEFT JOIN order_lines ol ON s.order_line_id = ol.id
            WHERE b.status = "Verified"
        `;
        const params = [];

        if (startDate) {
            query += ' AND b.bill_date >= ?';
            params.push(startDate);
        }
        if (endDate) {
            // Add 1 day to endDate to include the full end day
            const end = new Date(endDate);
            end.setDate(end.getDate() + 1);
            query += ' AND b.bill_date < ?';
            params.push(end.toISOString().split('T')[0]);
        }

        query += ' GROUP BY b.id ORDER BY b.bill_date DESC';

        const [rows] = await db.query(query, params);
        const mapped = rows.map(row => {
            let cart = row.cart;
            let custom_rates = row.custom_rates;
            try { if (typeof cart === 'string') cart = JSON.parse(cart); } catch { cart = {}; }
            try { if (typeof custom_rates === 'string') custom_rates = JSON.parse(custom_rates); } catch { custom_rates = {}; }
            return { ...row, cart, custom_rates };
        });
        res.json(mapped);
    } catch (err) {
        console.error('Error fetching bills by date range:', err.message || err);
        res.status(500).json({ error: 'Failed to fetch bills by date range', detail: err.message });
    }
};
