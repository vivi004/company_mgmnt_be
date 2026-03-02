const db = require('../config/db');

exports.getAllCategories = async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM categories ORDER BY name ASC');
        res.json(rows);
    } catch (err) {
        console.error('Error fetching categories:', err);
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
};

exports.createCategory = async (req, res) => {
    const { name, icon } = req.body;
    if (!name) return res.status(400).json({ error: 'Category name is required' });

    try {
        const [result] = await db.query(
            'INSERT INTO categories (name, icon) VALUES (?, ?)',
            [name, icon || '🏷️']
        );
        res.status(201).json({ id: result.insertId, name, icon: icon || '🏷️' });
    } catch (err) {
        console.error('Error creating category:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Category already exists' });
        }
        res.status(500).json({ error: 'Failed to create category' });
    }
};

exports.deleteCategory = async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('DELETE FROM categories WHERE id = ?', [id]);
        res.json({ message: 'Category deleted successfully' });
    } catch (err) {
        console.error('Error deleting category:', err);
        res.status(500).json({ error: 'Failed to delete category' });
    }
};
