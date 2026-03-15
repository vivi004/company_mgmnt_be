const db = require('../config/db');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

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
        let orderlinesVal = null;
        if (accessible_orderlines && Array.isArray(accessible_orderlines)) {
            orderlinesVal = JSON.stringify(accessible_orderlines);
        }

        if (password && password.trim() !== '') {
            // A new password was provided — hash and update it
            const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
            await db.query(
                'UPDATE employees SET first_name=?, last_name=?, email=?, role=?, status=?, username=?, password=?, accessible_orderlines=?, profile_pic=? WHERE id=?',
                [first_name, last_name, email, role, status, username, hashedPassword, orderlinesVal, profile_pic, id]
            );
        } else {
            // No new password — preserve the existing one
            await db.query(
                'UPDATE employees SET first_name=?, last_name=?, email=?, role=?, status=?, username=?, accessible_orderlines=?, profile_pic=? WHERE id=?',
                [first_name, last_name, email, role, status, username, orderlinesVal, profile_pic, id]
            );
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
