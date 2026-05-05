const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
    const { username, password } = req.body;

    try {
        const [rows] = await db.query(
            'SELECT * FROM employees WHERE username = ? AND status = "Active"',
            [username]
        );

        if (rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Invalid username or password'
            });
        }

        const user = rows[0];
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Invalid username or password'
            });
        }

        // Automatic Hash Downgrade logic for faster future logins
        // Bcrypt hashes start with '$2b$CostFactor$...' or '$2a$CostFactor$...'
        // If the cost factor is '12', downgrade it to '08' for improved login speed.
        if (user.password && (user.password.startsWith('$2b$12$') || user.password.startsWith('$2a$12$'))) {
            try {
                const fasterHash = await bcrypt.hash(password, 8);
                await db.query('UPDATE employees SET password = ? WHERE id = ?', [fasterHash, user.id]);
            } catch (hashErr) {
                console.error('Failed to downgrade hash for user:', user.username, hashErr);
            }
        }

        const token = jwt.sign(
            { id: user.id, role: user.role.toLowerCase() },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        return res.json({
            success: true,
            token,
            role: user.role.toLowerCase(),
            user: {
                id: user.id,
                username: user.username,
                first_name: user.first_name,
                last_name: user.last_name,
                email: user.email || '',
                accessible_orderlines: user.accessible_orderlines,
                profile_pic: user.profile_pic || ''
            }
        });
    } catch (err) {
    console.error('Login error FULL:', err);
    return res.status(500).json({ 
        success: false, 
        message: err.message 
    });
}
};
