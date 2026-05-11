const express = require('express');
const cors = require('cors');
const compression = require('compression');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET is not defined in environment variables.');
    process.exit(1);
}

app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

const employeeRoutes = require('./routes/employeeRoutes');
const authRoutes = require('./routes/authRoutes');
const requestRoutes = require('./routes/requestRoutes');
const orderLineRoutes = require('./routes/orderLineRoutes');
const shopRoutes = require('./routes/shopRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const billRoutes = require('./routes/billRoutes');
const productRoutes = require('./routes/productRoutes');
const collectionRoutes = require('./routes/collectionRoutes');

app.use('/api/employees', employeeRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/order-lines', orderLineRoutes);
app.use('/api/shops', shopRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/bills', billRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/products', productRoutes);
app.use('/api/collections', collectionRoutes);


app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Backend is running smoothly' });
});

// Global error handler
app.use((err, req, res, _next) => {
    console.error('Unhandled error:', err.stack);
    res.status(500).json({ error: 'An internal server error occurred.' });
});

// Prevent crash on unhandled rejections (like DB connection failure)
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception thrown:', err.stack);
});

app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);
    
    // Auto-initialize database tables if they don't exist
    try {
        const db = require('./config/db');
        await db.query(`
            CREATE TABLE IF NOT EXISTS product_rates (
                product_id VARCHAR(50) PRIMARY KEY,
                rate DECIMAL(10, 2) NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        // Ensure app_settings exists
        await db.query(`
            CREATE TABLE IF NOT EXISTS app_settings (
                id INT PRIMARY KEY DEFAULT 1,
                next_invoice_no INT NOT NULL DEFAULT 1001,
                last_invoice_no INT NOT NULL DEFAULT 1000,
                ledger_sheet_url TEXT,
                revoked_at TIMESTAMP DEFAULT '2000-01-01 00:00:00',
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        // Insert default row if not present
        await db.query(`
            INSERT IGNORE INTO app_settings (id, next_invoice_no, last_invoice_no)
            VALUES (1, 1001, 1000)
        `);

        // --- BILLS TABLE STABILIZATION ---
        // Ensure all modern columns exist for financial synchronization
        const billColumns = [
            { name: 'shop_id', type: 'INT AFTER id' },
            { name: 'total_amount', type: 'DECIMAL(12, 2) DEFAULT 0.00' },
            { name: 'delivery_date', type: 'DATETIME DEFAULT NULL' },
            { name: 'is_edited_price', type: 'BOOLEAN DEFAULT FALSE' },
            { name: 'is_applied_to_balance', type: 'BOOLEAN DEFAULT FALSE' }
        ];

        for (const col of billColumns) {
            try {
                await db.query(`ALTER TABLE bills ADD COLUMN ${col.name} ${col.type}`);
                console.log(`Column '${col.name}' added to bills.`);
            } catch (e) {
                // Column likely exists, skip
            }
        }

        // Migration: Populate shop_id based on name matches for legacy bills
        try {
            await db.query(`
                UPDATE bills b
                JOIN shops s ON TRIM(b.shop_name) = TRIM(s.shop_name) AND TRIM(b.village_name) = TRIM(s.village_name)
                SET b.shop_id = s.id
                WHERE b.shop_id IS NULL
            `);
            console.log('Existing bills linked to Shop IDs.');
        } catch (e) {
            console.error('Bill migration warning:', e.message);
        }

        // Ensure daily_collections table exists
        await db.query(`
            CREATE TABLE IF NOT EXISTS daily_collections (
                id INT AUTO_INCREMENT PRIMARY KEY,
                shop_id INT NOT NULL,
                shop_name VARCHAR(255) NOT NULL,
                village_name VARCHAR(255) NOT NULL,
                order_line_id INT NOT NULL,
                collection_date DATE NOT NULL,
                todays_bill_amount DECIMAL(12, 2) DEFAULT 0.00,
                cash_collected DECIMAL(12, 2) DEFAULT 0.00,
                upi_collected DECIMAL(12, 2) DEFAULT 0.00,
                cheque_collected DECIMAL(12, 2) DEFAULT 0.00,
                old_balance DECIMAL(12, 2) DEFAULT 0.00,
                total_balance DECIMAL(12, 2) DEFAULT 0.00,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_shop_date (shop_id, collection_date)
            )
        `);

        console.log('Database tables verified/initialized.');
    } catch (err) {
        console.error('Database initialization warning:', err.message);
    }
    
    console.log('Press Ctrl+C to stop');
});
