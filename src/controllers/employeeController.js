const db = require('../config/db');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 8;

exports.getAllEmployees = async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT id, first_name, last_name, email, role, status, username, joined_at, accessible_orderlines, profile_pic FROM employees ORDER BY joined_at DESC'
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.createEmployee = async (req, res) => {
    const { first_name, last_name, email, role, status, username, password, accessible_orderlines, profile_pic } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        let orderlinesVal = null;
        if (accessible_orderlines && Array.isArray(accessible_orderlines)) {
            orderlinesVal = JSON.stringify(accessible_orderlines);
        }

        const [result] = await db.query(
            'INSERT INTO employees (first_name, last_name, email, role, status, username, password, accessible_orderlines, profile_pic) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [first_name, last_name, email, role, status || 'Active', username, hashedPassword, orderlinesVal, profile_pic]
        );
        const { password: _pw, ...safeBody } = req.body;
        res.status(201).json({ id: result.insertId, ...safeBody });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.updateEmployee = async (req, res) => {
    const { id } = req.params;
    const { first_name, last_name, email, role, status, username, password, accessible_orderlines, profile_pic } = req.body;
    try {
        // 1. Get the current name before update to handle cascading changes in bills/transactions
        const [oldRows] = await db.query('SELECT first_name, last_name FROM employees WHERE id = ?', [id]);
        let oldName = null;
        if (oldRows.length > 0) {
            oldName = `${oldRows[0].first_name} ${oldRows[0].last_name || ''}`.trim();
        }
        
        const newName = `${first_name} ${last_name || ''}`.trim();

        let orderlinesVal = null;
        if (accessible_orderlines && Array.isArray(accessible_orderlines)) {
            orderlinesVal = JSON.stringify(accessible_orderlines);
        }

        if (password && password.trim() !== '') {
            const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
            await db.query(
                'UPDATE employees SET first_name=?, last_name=?, email=?, role=?, status=?, username=?, password=?, accessible_orderlines=?, profile_pic=? WHERE id=?',
                [first_name, last_name, email, role, status, username, hashedPassword, orderlinesVal, profile_pic, id]
            );
        } else {
            await db.query(
                'UPDATE employees SET first_name=?, last_name=?, email=?, role=?, status=?, username=?, accessible_orderlines=?, profile_pic=? WHERE id=?',
                [first_name, last_name, email, role, status, username, orderlinesVal, profile_pic, id]
            );
        }

        // 2. If name changed, cascade the change to bills and transactions
        if (oldName && oldName !== newName) {
            await db.query('UPDATE bills SET created_by = ? WHERE created_by = ?', [newName, oldName]);
            await db.query('UPDATE shop_transactions SET created_by = ? WHERE created_by = ?', [newName, oldName]);
        }

        res.json({ message: 'Employee updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.updateProfilePic = async (req, res) => {
    const { id } = req.params;
    const { profile_pic } = req.body;
    try {
        await db.query('UPDATE employees SET profile_pic = ? WHERE id = ?', [profile_pic, id]);
        res.json({ message: 'Profile picture updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.deleteEmployee = async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('DELETE FROM employees WHERE id=?', [id]);
        res.json({ message: 'Employee deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
