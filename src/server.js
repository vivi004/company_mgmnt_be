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

app.use('/api/employees', employeeRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/order-lines', orderLineRoutes);
app.use('/api/shops', shopRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/bills', billRoutes);
app.use('/api/settings', settingsRoutes);


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

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log('Press Ctrl+C to stop');
});
