const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');
const authMiddleware = require('../middleware/authMiddleware');

// Public/Staff can view categories
router.get('/', authMiddleware, categoryController.getAllCategories);

// Only Admin can add/delete categories
router.post('/', authMiddleware, authMiddleware.authorizeRole('admin'), categoryController.createCategory);
router.delete('/:id', authMiddleware, authMiddleware.authorizeRole('admin'), categoryController.deleteCategory);

module.exports = router;
