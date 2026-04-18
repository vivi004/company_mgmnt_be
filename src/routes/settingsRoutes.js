const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');

router.get('/invoice', settingsController.getInvoiceSettings);
router.put('/invoice', settingsController.updateInvoiceSettings);

module.exports = router;
