const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const shopController = require('../controllers/shopController');
const authMiddleware = require('../middleware/authMiddleware');

const shopValidation = [
    body('shop_name').trim().notEmpty().withMessage('Shop name is required'),
    body('order_line_id').isInt({ gt: 0 }).withMessage('Valid order_line_id is required')
];

const updateValidation = [
    body('shop_name').trim().notEmpty().withMessage('Shop name is required')
];

router.get('/', authMiddleware, shopController.getAllShops);
router.get('/by-village/:order_line_id', authMiddleware, shopController.getShopsByOrderLine);
router.post('/', authMiddleware, shopValidation, shopController.createShop);
router.put('/:id', authMiddleware, updateValidation, shopController.updateShop);
router.delete('/:id', authMiddleware, shopController.deleteShop);

// Financial Routes
router.post('/:id/collect-payment', authMiddleware, shopController.collectPayment);
router.get('/:id/ledger', authMiddleware, shopController.getShopLedger);
router.post('/:id/adjust-balance', authMiddleware, shopController.adjustBalance);

module.exports = router;
