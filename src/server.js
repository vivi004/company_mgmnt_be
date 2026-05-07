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

app.use('/api/employees', employeeRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/order-lines', orderLineRoutes);
app.use('/api/shops', shopRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/bills', billRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/products', productRoutes);


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

        // Ensure is_edited_price column exists in bills
        try {
            await db.query('ALTER TABLE bills ADD COLUMN is_edited_price BOOLEAN DEFAULT FALSE');
        } catch (e) {}

        console.log('Database tables verified/initialized.');
    } catch (err) {
        console.error('Database initialization warning:', err.message);
    }
    
    console.log('Press Ctrl+C to stop');
});
