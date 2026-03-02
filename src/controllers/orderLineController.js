const db = require('../config/db');

exports.getAllOrderLines = async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM order_lines ORDER BY created_at DESC');
        res.json(rows);
    } catch (err) {
        console.error('Error fetching order lines:', err);
        res.status(500).json({ error: 'Failed to fetch order lines' });
    }
};

exports.createOrderLine = async (req, res) => {
    const { name, node_id } = req.body;
    try {
        const [result] = await db.query(
            'INSERT INTO order_lines (name, node_id) VALUES (?, ?)',
            [name, node_id]
        );
        res.status(201).json({ id: result.insertId, name, node_id });
    } catch (err) {
        console.error('Error adding order line:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Node ID already exists' });
        }
        res.status(500).json({ error: 'Failed to add order line' });
    }
};

exports.requestDeleteOrderLine = async (req, res) => {
    const { order_line_id, employee_id } = req.body;
    try {
        const [existing] = await db.query(
            'SELECT * FROM order_line_requests WHERE order_line_id = ? AND status = "Pending"',
            [order_line_id]
        );
        if (existing.length > 0) {
            return res.status(400).json({ error: 'A deletion request is already pending for this sector' });
        }

        await db.query(
            'INSERT INTO order_line_requests (order_line_id, employee_id, type) VALUES (?, ?, "DELETE")',
            [order_line_id, employee_id]
        );
        res.status(201).json({ message: 'Deletion request sent for admin approval' });
    } catch (err) {
        console.error('Error submitting deletion request:', err);
        res.status(500).json({ error: 'Failed to submit deletion request' });
    }
};

exports.getPendingDeleteRequests = async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT olr.*, ol.name as order_line_name, ol.node_id, e.first_name, e.last_name 
            FROM order_line_requests olr 
            JOIN order_lines ol ON olr.order_line_id = ol.id 
            JOIN employees e ON olr.employee_id = e.id 
            WHERE olr.status = 'Pending'
            ORDER BY olr.created_at DESC
        `);
        res.json(rows);
    } catch (err) {
        console.error('Error fetching order line requests:', err);
        res.status(500).json({ error: 'Failed to fetch requests' });
    }
};

exports.approveDeleteRequest = async (req, res) => {
    const { id } = req.params;
    try {
        const [requests] = await db.query('SELECT * FROM order_line_requests WHERE id = ?', [id]);
        if (requests.length === 0) return res.status(404).json({ error: 'Request not found' });

        const request = requests[0];
        // Delete the order line
        await db.query('DELETE FROM order_lines WHERE id = ?', [request.order_line_id]);
        // Update approved request status
        await db.query('UPDATE order_line_requests SET status = "Approved" WHERE id = ?', [id]);
        // Clean up any other orphaned pending requests for the same order line
        await db.query(
            'UPDATE order_line_requests SET status = "Cancelled" WHERE order_line_id = ? AND status = "Pending"',
            [request.order_line_id]
        );
        res.json({ message: 'Sector deleted and request approved' });
    } catch (err) {
        console.error('Error approving deletion:', err);
        res.status(500).json({ error: 'Failed to approve deletion' });
    }
};

exports.rejectDeleteRequest = async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('UPDATE order_line_requests SET status = "Rejected" WHERE id = ?', [id]);
        res.json({ message: 'Deletion request rejected' });
    } catch (err) {
        console.error('Error rejecting deletion:', err);
        res.status(500).json({ error: 'Failed to reject request' });
    }
};

exports.updateOrderLine = async (req, res) => {
    const { id } = req.params;
    const { name, node_id } = req.body;
    try {
        await db.query(
            'UPDATE order_lines SET name = ?, node_id = ? WHERE id = ?',
            [name, node_id, id]
        );
        res.json({ message: 'Order line updated successfully' });
    } catch (err) {
        console.error('Error updating order line:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Node ID already exists' });
        }
        res.status(500).json({ error: 'Failed to update order line' });
    }
};

exports.deleteOrderLine = async (req, res) => {
    const { id } = req.params;
    try {
        // Clean up related requests first
        await db.query(
            'UPDATE order_line_requests SET status = "Cancelled" WHERE order_line_id = ? AND status = "Pending"',
            [id]
        );
        await db.query('DELETE FROM order_lines WHERE id = ?', [id]);
        res.json({ message: 'Order line deleted successfully' });
    } catch (err) {
        console.error('Error deleting order line:', err);
        res.status(500).json({ error: 'Failed to delete order line' });
    }
};
