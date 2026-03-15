const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const employeeController = require('../controllers/employeeController');
const authMiddleware = require('../middleware/authMiddleware');

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

const employeeValidation = [
    body('first_name').trim().notEmpty().withMessage('First name is required'),
    body('last_name').trim().notEmpty().withMessage('Last name is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('username').trim().notEmpty().withMessage('Username is required'),
    body('role').isIn(['Admin', 'Staff']).withMessage('Role must be Admin or Staff'),
    body('status').isIn(['Active', 'Suspended']).withMessage('Status must be Active or Suspended')
];

router.get('/', authMiddleware, employeeController.getAllEmployees);
router.post('/',
    authMiddleware,
    [...employeeValidation, body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')],
    validate,
    employeeController.createEmployee
);
router.put('/:id',
    authMiddleware,
    employeeValidation,
    validate,
    employeeController.updateEmployee
);
router.put('/:id/profile-pic', authMiddleware, employeeController.updateProfilePic);
router.delete('/:id', authMiddleware, employeeController.deleteEmployee);

module.exports = router;
