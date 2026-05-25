const express = require('express');
const router = express.Router();
const shopLinksController = require('../controllers/shopLinksController');
const authMiddleware = require('../middleware/authMiddleware');

router.post('/link', authMiddleware, shopLinksController.linkShops);
router.post('/unlink', authMiddleware, shopLinksController.unlinkShop);
router.get('/shop/:id', authMiddleware, shopLinksController.getShopLinks);
router.get('/duplicates', authMiddleware, shopLinksController.getDuplicateSuggestions);
router.post('/collect-split', authMiddleware, shopLinksController.collectSplitPayment);

module.exports = router;
