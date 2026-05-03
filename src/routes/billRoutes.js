const express = require('express');
const router = express.Router();
const billController = require('../controllers/billController');
const authMiddleware = require('../middleware/authMiddleware');

router.post('/', authMiddleware, billController.createBill);
router.get('/', authMiddleware, billController.getAllBills);
router.get('/unverified', authMiddleware, billController.getUnverifiedBills);
router.get('/date-range', authMiddleware, billController.getBillsByDateRange);
router.put('/verify/:id', authMiddleware, billController.verifyBill);
router.put('/:id', authMiddleware, billController.updateBill);
router.delete('/:id', authMiddleware, billController.deleteBill);

module.exports = router;
