const db = require('../config/db');
const notificationService = require('../services/notificationService');

exports.submitProfileRequest = async (req, res) => {
    const { employee_id, first_name, last_name, email } = req.body;
    try {
        await db.query(
            'INSERT INTO profile_requests (employee_id, first_name, last_name, email) VALUES (?, ?, ?, ?)',
            [employee_id, first_name, last_name, email]
        );
        res.status(201).json({ message: 'Request submitted successfully. Waiting for admin approval.' });
    } catch (err) {
        console.error('Error submitting request:', err);
        res.status(500).json({ error: 'Failed to submit request' });
    }
};

exports.getPendingProfileRequests = async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT pr.*, e.first_name as current_first_name, e.last_name as current_last_name 
            FROM profile_requests pr 
            JOIN employees e ON pr.employee_id = e.id 
            WHERE pr.status = 'Pending'
            ORDER BY pr.created_at DESC
        `);
        res.json(rows);
    } catch (err) {
        console.error('Error fetching requests:', err);
        res.status(500).json({ error: 'Failed to fetch requests' });
    }
};

exports.approveProfileRequest = async (req, res) => {
    const { id } = req.params;
    try {
        const [requests] = await db.query('SELECT * FROM profile_requests WHERE id = ?', [id]);
        if (requests.length === 0) return res.status(404).json({ error: 'Request not found' });

        const request = requests[0];
        
        // Fetch current employee name before updating for cascading changes
        const [oldEmps] = await db.query('SELECT first_name, last_name FROM employees WHERE id = ?', [request.employee_id]);
        let oldName = null;
        if (oldEmps.length > 0) {
            oldName = `${oldEmps[0].first_name} ${oldEmps[0].last_name || ''}`.trim();
        }
        const newName = `${request.first_name} ${request.last_name || ''}`.trim();

        await db.query(
            'UPDATE employees SET first_name = ?, last_name = ?, email = ? WHERE id = ?',
            [request.first_name, request.last_name, request.email, request.employee_id]
        );

        // Cascade the name change to historical records
        if (oldName && oldName !== newName) {
            await db.query('UPDATE bills SET created_by = ? WHERE created_by = ?', [newName, oldName]);
            await db.query('UPDATE shop_transactions SET created_by = ? WHERE created_by = ?', [newName, oldName]);
        }

        await db.query('UPDATE profile_requests SET status = "Approved" WHERE id = ?', [id]);
        res.json({ message: 'Request approved and profile updated!' });

        // Send push notification
        notificationService.sendPushToUser(
            request.employee_id,
            "Profile Request Approved ✅",
            "Your profile change request has been approved by the Admin."
        ).catch(err => console.error("Push notify error:", err));
    } catch (err) {
        console.error('Error approving request:', err);
        res.status(500).json({ error: 'Failed to approve request' });
    }
};

exports.rejectProfileRequest = async (req, res) => {
    const { id } = req.params;
    try {
        const [requests] = await db.query('SELECT employee_id FROM profile_requests WHERE id = ?', [id]);
        await db.query('UPDATE profile_requests SET status = "Rejected" WHERE id = ?', [id]);
        res.json({ message: 'Request rejected.' });

        if (requests.length > 0) {
            notificationService.sendPushToUser(
                requests[0].employee_id,
                "Profile Request Rejected ❌",
                "Your profile change request was rejected."
            ).catch(err => console.error("Push notify error:", err));
        }
    } catch (err) {
        console.error('Error rejecting request:', err);
        res.status(500).json({ error: 'Failed to reject request' });
    }
};

exports.getMyRequestStatus = async (req, res) => {
    const { employee_id } = req.params;
    try {
        const [rows] = await db.query(
            'SELECT * FROM profile_requests WHERE employee_id = ? AND status = "Approved" AND notified = FALSE',
            [employee_id]
        );
        res.json(rows);
    } catch (err) {
        console.error('Error fetching notification status:', err);
        res.status(500).json({ error: 'Failed to fetch status' });
    }
};

exports.acknowledgeNotification = async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('UPDATE profile_requests SET notified = TRUE WHERE id = ?', [id]);
        res.json({ message: 'Notification acknowledged.' });
    } catch (err) {
        console.error('Error acknowledging notification:', err);
        res.status(500).json({ error: 'Failed to acknowledge status' });
    }
};
