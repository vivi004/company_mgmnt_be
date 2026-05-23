const express = require('express');
const router = express.Router();
const collectionController = require('../controllers/collectionController');
const authMiddleware = require('../middleware/authMiddleware');

// GET all collections for a date (Admin)
router.get('/', authMiddleware, collectionController.getCollectionsByDate);

// GET overall returned products for a date (Admin)
router.get('/returns', authMiddleware, collectionController.getDailyReturns);

// GET collections for a specific order line + date (Admin + Staff)
router.get('/by-orderline/:olId', authMiddleware, collectionController.getCollectionsByOrderLine);

// POST a new expense (Admin + Staff)
router.post('/expenses', authMiddleware, collectionController.addExpense);

// UPDATE an expense (Admin + Staff)
router.put('/expenses/:id', authMiddleware, collectionController.updateExpense);

// DELETE an expense (Admin + Staff)
router.delete('/expenses/:id', authMiddleware, collectionController.deleteExpense);

// Admin-only collection & ledger edit routes
router.get('/shop-day-details', authMiddleware, collectionController.getShopDayDetails);
router.put('/transactions/:id/payment', authMiddleware, collectionController.editPaymentTransaction);
router.put('/transactions/:id/adjustment', authMiddleware, collectionController.editAdjustmentTransaction);
router.delete('/transactions/:id', authMiddleware, collectionController.deleteTransaction);
router.put('/returns/:id', authMiddleware, collectionController.editProductReturn);
router.delete('/returns/:id', authMiddleware, collectionController.deleteProductReturn);
router.post('/transactions/add-retroactive', authMiddleware, collectionController.addRetroactiveTransaction);

// Daily physical cash tally routes
router.get('/tally', authMiddleware, collectionController.getDailyTally);
router.post('/tally', authMiddleware, collectionController.saveDailyTally);

module.exports = router;
