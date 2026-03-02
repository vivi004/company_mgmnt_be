const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const orderLineController = require('../controllers/orderLineController');
const authMiddleware = require('../middleware/authMiddleware');

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

const orderLineValidation = [
    body('name').trim().notEmpty().withMessage('Sector name is required'),
    body('node_id').trim().notEmpty().withMessage('Node ID is required')
];

router.get('/', authMiddleware, orderLineController.getAllOrderLines);
router.post('/', authMiddleware, orderLineValidation, validate, orderLineController.createOrderLine);
router.post('/request-delete',
    authMiddleware,
    [
        body('order_line_id').isInt({ gt: 0 }).withMessage('Valid order_line_id is required'),
        body('employee_id').isInt({ gt: 0 }).withMessage('Valid employee_id is required')
    ],
    validate,
    orderLineController.requestDeleteOrderLine
);
router.get('/requests', authMiddleware, orderLineController.getPendingDeleteRequests);
router.put('/requests/:id/approve', authMiddleware, orderLineController.approveDeleteRequest);
router.put('/requests/:id/reject', authMiddleware, orderLineController.rejectDeleteRequest);
router.put('/:id', authMiddleware, orderLineValidation, validate, orderLineController.updateOrderLine);
router.delete('/:id', authMiddleware, orderLineController.deleteOrderLine);

module.exports = router;
