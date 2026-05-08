const db = require('../config/db');

exports.getAllOrderLines = async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT ol.*, 
                   COALESCE(SUM(s.balance), 0) as total_balance,
                   COUNT(s.id) as shop_count
            FROM order_lines ol
            LEFT JOIN shops s ON ol.id = s.order_line_id
            GROUP BY ol.id
            ORDER BY ol.created_at DESC
        `);
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
        
        // Use a transaction for the deletion process
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            
            // 1. Delete transactions for all shops in this village
            await connection.query('DELETE FROM shop_transactions WHERE shop_id IN (SELECT id FROM shops WHERE order_line_id = ?)', [request.order_line_id]);
            
            // 2. Delete bills for all shops in this village (Now using precise shop IDs)
            await connection.query('DELETE FROM bills WHERE shop_id IN (SELECT id FROM shops WHERE order_line_id = ?)', [request.order_line_id]);

            // 3. Delete the shops
            await connection.query('DELETE FROM shops WHERE order_line_id = ?', [request.order_line_id]);
            
            // 4. Delete the order line
            await connection.query('DELETE FROM order_lines WHERE id = ?', [request.order_line_id]);
            
            // Update approved request status
            await connection.query('UPDATE order_line_requests SET status = "Approved" WHERE id = ?', [id]);
            
            await connection.commit();
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
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
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            
            // 1. Get the current name before update to handle cascading changes
            const [oldRows] = await connection.query('SELECT name FROM order_lines WHERE id = ?', [id]);
            const oldName = oldRows.length > 0 ? oldRows[0].name : null;

            // 2. Update the order line
            await connection.query(
                'UPDATE order_lines SET name = ?, node_id = ? WHERE id = ?',
                [name, node_id, id]
            );
            
            // 3. Sync the village_name in the shops table for consistency
            await connection.query(
                'UPDATE shops SET village_name = ? WHERE order_line_id = ?',
                [name, id]
            );

            // 4. Cascade the change to the bills table so history remains linked
            // Since bills are linked by shop_id, we update village_name for all shops in this village
            if (oldName && oldName !== name) {
                await connection.query(
                    'UPDATE bills SET village_name = ? WHERE shop_id IN (SELECT id FROM shops WHERE order_line_id = ?)',
                    [name, id]
                );
            }
            
            await connection.commit();
        } catch (err) {
            if (connection) await connection.rollback();
            throw err;
        } finally {
            if (connection) connection.release();
        }
        res.json({ message: 'Order line and associated shops updated successfully' });
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
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            
            // Clean up related requests first
            await connection.query(
                'UPDATE order_line_requests SET status = "Cancelled" WHERE order_line_id = ? AND status = "Pending"',
                [id]
            );
            
            // 1. Delete transactions for all shops in this village
            await connection.query('DELETE FROM shop_transactions WHERE shop_id IN (SELECT id FROM shops WHERE order_line_id = ?)', [id]);
            
            // 2. Delete bills for all shops in this village
            await connection.query('DELETE FROM bills WHERE shop_id IN (SELECT id FROM shops WHERE order_line_id = ?)', [id]);

            // 3. Delete the shops
            await connection.query('DELETE FROM shops WHERE order_line_id = ?', [id]);
            
            // 4. Delete the order line itself
            await connection.query('DELETE FROM order_lines WHERE id = ?', [id]);
            
            await connection.commit();
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
        res.json({ message: 'Order line and associated shops deleted successfully' });
    } catch (err) {
        console.error('Error deleting order line:', err);
        res.status(500).json({ error: 'Failed to delete order line' });
    }
};
