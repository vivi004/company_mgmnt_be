const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');

const authMiddleware = require('../middleware/authMiddleware');
router.get('/invoice', settingsController.getInvoiceSettings);
router.put('/invoice', settingsController.updateInvoiceSettings);

// Motor Vehicles
router.get('/vehicles', settingsController.getMotorVehicles);
router.post('/vehicles', settingsController.addMotorVehicle);
router.delete('/vehicles/:id', settingsController.deleteMotorVehicle);

// Global Session Management
router.post('/logout-all', authMiddleware, authMiddleware.authorizeRole('admin'), settingsController.logoutAllStaff);
router.post('/reset-database', authMiddleware, authMiddleware.authorizeRole('admin'), settingsController.resetDatabase);

module.exports = router;
