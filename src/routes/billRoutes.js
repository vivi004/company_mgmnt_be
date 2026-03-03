const express = require('express');
const router = express.Router();
const billController = require('../controllers/billController');

router.post('/', billController.createBill);
router.get('/', billController.getAllBills);
router.get('/unverified', billController.getUnverifiedBills);
router.put('/verify/:id', billController.verifyBill);
router.put('/:id', billController.updateBill);
router.delete('/:id', billController.deleteBill);

module.exports = router;
