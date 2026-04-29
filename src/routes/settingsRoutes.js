const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');

router.get('/invoice', settingsController.getInvoiceSettings);
router.put('/invoice', settingsController.updateInvoiceSettings);

// Motor Vehicles
router.get('/vehicles', settingsController.getMotorVehicles);
router.post('/vehicles', settingsController.addMotorVehicle);
router.delete('/vehicles/:id', settingsController.deleteMotorVehicle);

module.exports = router;
