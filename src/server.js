const express = require('express');
const cors = require('cors');
const compression = require('compression');
const dotenv = require('dotenv');
const Sentry = require('@sentry/node');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

dotenv.config();

// 1. Initialize Sentry Crash Monitoring & Tracking (Conditional on SENTRY_DSN env)
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'production',
        tracesSampleRate: 0.2, // Track 20% of HTTP request transactions for performance tracing
    });
    console.log('[SENTRY] Error tracking successfully initialized.');
}

const app = express();
const PORT = process.env.PORT || 5001;

// 1b. Verify mandatory startup credentials & log missing configuration securely
const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'JWT_SECRET'];
const missingVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingVars.length > 0) {
    console.error(`\x1b[31m[CRITICAL STARTUP ERROR] Missing mandatory environment configurations: ${missingVars.join(', ')}\x1b[0m`);
    if (process.env.SENTRY_DSN) {
        Sentry.captureException(new Error(`Server failed to start due to missing environment variables: ${missingVars.join(', ')}`));
    }
    process.exit(1);
} else {
    console.log('\x1b[32m[STARTUP SUCCESS] All mandatory environment credentials verified successfully.\x1b[0m');
}

// 2. Register Sentry Request Handler as the VERY first Express middleware
if (process.env.SENTRY_DSN) {
    app.use(Sentry.Handlers.requestHandler());
}

// Global HTTP Security Headers Protection
app.use(helmet());

// Configure restricted CORS policy
const allowedOrigins = process.env.ALLOWED_CLIENT_URLS?.split(',') || [
    'http://localhost:5173',
    'http://localhost:5174',
    'https://company-mgmnt-fe.onrender.com'
];
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS policy'));
        }
    },
    credentials: true
}));


app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Enforce API rate-limiting on authentication entry points to protect against brute force
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // Allow maximum 50 requests per 15 minutes per IP
    message: { error: 'Too many authentication attempts. Please try again after 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/auth/login', authLimiter);

// 3. Register Structured logging and performance middleware
const requestLogger = require('./middleware/requestLogger');
app.use(requestLogger);

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
const { startScheduler } = require('./services/schedulerService');

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

// 4. Uptime Monitoring Health Check Probe Endpoint (Lightweight & Safe)
const db = require('./config/db');

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// Backward compatibility health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Backend is running smoothly' });
});

// 5. Register Sentry Error Handler BEFORE our custom global error handler
if (process.env.SENTRY_DSN) {
    app.use(Sentry.Handlers.errorHandler());
}

// Global error handler
app.use((err, req, res, _next) => {
    console.error('Unhandled error:', err.stack);
    
    if (process.env.SENTRY_DSN) {
        Sentry.captureException(err);
    }
    
    res.status(500).json({ error: 'An internal server error occurred.' });
});

// 6. Prevent server crash on unhandled exceptions and log them to Sentry
process.on('unhandledRejection', (reason, promise) => {
    console.error('[FATAL REJECTION] Unhandled Rejection at:', promise, 'reason:', reason);
    if (process.env.SENTRY_DSN) {
        Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
    }
});

process.on('uncaughtException', (err) => {
    console.error('[FATAL EXCEPTION] Uncaught Exception thrown:', err.stack);
    if (process.env.SENTRY_DSN) {
        Sentry.captureException(err);
    }
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

        // Ensure sheet_backup table exists for zero-downtime rates recovery fallback
        await db.query(`
            CREATE TABLE IF NOT EXISTS sheet_backup (
                id INT AUTO_INCREMENT PRIMARY KEY,
                data LONGTEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_valid BOOLEAN DEFAULT TRUE
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

        // Retrieve existing column list to prevent duplicate-column SQL exceptions
        const [existingBillsCols] = await db.query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bills'
        `);
        const billsColNames = existingBillsCols.map(c => c.COLUMN_NAME.toLowerCase());

        for (const col of billColumns) {
            if (!billsColNames.includes(col.name.toLowerCase())) {
                try {
                    await db.query(`ALTER TABLE bills ADD COLUMN ${col.name} ${col.type}`);
                    console.log(`Column '${col.name}' added to bills.`);
                } catch (e) {
                    // Ignore transient error
                }
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

        // Ensure product_returns table exists
        await db.query(`
            CREATE TABLE IF NOT EXISTS product_returns (
                id INT AUTO_INCREMENT PRIMARY KEY,
                shop_id INT NOT NULL,
                product_name VARCHAR(255) NOT NULL,
                amount DECIMAL(12, 2) NOT NULL,
                created_by VARCHAR(255) NOT NULL,
                return_date DATE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
            )
        `);

        // Alter shop_transactions ENUM to include 'Return'
        try {
            await db.query(`
                ALTER TABLE shop_transactions 
                MODIFY COLUMN type ENUM('Bill', 'Payment', 'Adjustment', 'Opening Balance', 'Return') NOT NULL
            `);
            console.log("Updated shop_transactions type enum to support 'Return'");
        } catch (e) {
            console.error('Warning altering shop_transactions type:', e.message);
        }

        // Ensure daily_collections has all required columns
        const dcColumns = [
            { name: 'future_bills', type: 'DECIMAL(12, 2) DEFAULT 0.00' },
            { name: 'manual_adjustments', type: 'DECIMAL(12, 2) DEFAULT 0.00' },
            { name: 'return_amount', type: 'DECIMAL(12, 2) DEFAULT 0.00' },
        ];

        // Retrieve existing columns for daily_collections to prevent duplicate column exception logs
        const [existingDcCols] = await db.query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'daily_collections'
        `);
        const dcColNames = existingDcCols.map(c => c.COLUMN_NAME.toLowerCase());

        for (const col of dcColumns) {
            if (!dcColNames.includes(col.name.toLowerCase())) {
                try {
                    await db.query(`ALTER TABLE daily_collections ADD COLUMN ${col.name} ${col.type}`);
                    console.log(`Column '${col.name}' added to daily_collections.`);
                } catch (e) {
                    // Ignore transient error
                }
            }
        }

        console.log('Database tables verified/initialized.');
    } catch (err) {
        console.error('Database initialization warning:', err.message);
    }

    // Start midnight IST rollover scheduler
    startScheduler();
    
    console.log('Press Ctrl+C to stop');
});
