const express = require('express');
const router = express.Router();
const collectionController = require('../controllers/collectionController');
const authMiddleware = require('../middleware/authMiddleware');

// GET all collections for a date (Admin)
router.get('/', authMiddleware, collectionController.getCollectionsByDate);

// GET collections for a specific order line + date (Admin + Staff)
router.get('/by-orderline/:olId', authMiddleware, collectionController.getCollectionsByOrderLine);

module.exports = router;
