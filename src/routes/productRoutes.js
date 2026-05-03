const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const authMiddleware = require('../middleware/authMiddleware');

// Anyone authenticated can view rates (Staff or Admin)
router.get('/rates', authMiddleware, productController.getProductRates);

// Only Admin can sync rates from Google Sheets
router.post('/sync', authMiddleware, authMiddleware.authorizeRole('Admin'), productController.syncProductRates);

module.exports = router;
