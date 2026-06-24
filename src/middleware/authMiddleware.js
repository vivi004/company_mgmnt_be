const jwt = require('jsonwebtoken');
const db = require('../config/db');

const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Session Revocation Check for Staff & Player
        if (decoded.role === 'staff' || decoded.role === 'player' || decoded.role === 'viewer') {
            try {
                const [rows] = await db.query('SELECT revoked_at FROM app_settings WHERE id = 1');
                if (rows && rows[0]) {
                    const revokedAt = new Date(rows[0].revoked_at).getTime();
                    const issuedAt = (decoded.iat || 0) * 1000;
                    
                    if (issuedAt < revokedAt) {
                        return res.status(401).json({ error: 'Your session has been revoked by admin. Please login again.' });
                    }
                }
            } catch (dbErr) {
                console.error('Revocation check error:', dbErr);
                // Continue if DB fails, rather than locking everyone out
            }
        }

        req.user = decoded; // { id, role, iat, exp }
        next();
    } catch (err) {
        if (err.name === 'JsonWebTokenError') {
            console.warn('\x1b[33m[AUTH WARNING] JWT signature mismatch or tampering detected.\x1b[0m');
        } else if (err.name === 'TokenExpiredError') {
            console.log('[AUTH INFO] Token expired naturally.');
        } else {
            console.error('[AUTH ERROR] Token verification failed:', err.message);
        }
        return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
    }
};

authMiddleware.authorizeRole = (role) => {
    return (req, res, next) => {
        // Normalize both sides to lowercase: JWT role is always lowercase (set by authController)
        if (!req.user || req.user.role.toLowerCase() !== role.toLowerCase()) {
            return res.status(403).json({ error: 'Forbidden: Access denied' });
        }
        next();
    };
};

module.exports = authMiddleware;
