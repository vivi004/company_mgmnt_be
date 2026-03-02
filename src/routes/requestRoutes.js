const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const requestController = require('../controllers/requestController');
const authMiddleware = require('../middleware/authMiddleware');

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

router.post('/',
    authMiddleware,
    [
        body('employee_id').isInt({ gt: 0 }).withMessage('Valid employee_id is required'),
        body('first_name').trim().notEmpty().withMessage('First name is required'),
        body('last_name').trim().notEmpty().withMessage('Last name is required'),
        body('email').isEmail().normalizeEmail().withMessage('Valid email is required')
    ],
    validate,
    requestController.submitProfileRequest
);
router.get('/', authMiddleware, requestController.getPendingProfileRequests);
router.put('/:id/approve', authMiddleware, requestController.approveProfileRequest);
router.put('/:id/reject', authMiddleware, requestController.rejectProfileRequest);
router.get('/my-status/:employee_id', authMiddleware, requestController.getMyRequestStatus);
router.put('/acknowledge/:id', authMiddleware, requestController.acknowledgeNotification);

module.exports = router;
