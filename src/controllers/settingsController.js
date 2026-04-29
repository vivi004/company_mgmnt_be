const db = require('../config/db');

// Ensure the settings table and default row exist
const ensureSettings = async () => {
    await db.query(`
        CREATE TABLE IF NOT EXISTS app_settings (
            id INT PRIMARY KEY DEFAULT 1,
            next_invoice_no INT NOT NULL DEFAULT 1001,
            last_invoice_no INT NOT NULL DEFAULT 1000,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);
    // Insert default row if not present
    await db.query(`
        INSERT IGNORE INTO app_settings (id, next_invoice_no, last_invoice_no)
        VALUES (1, 1001, 1000)
    `);
};

// Ensure motor_vehicles table exists
const ensureMotorVehiclesTable = async () => {
    await db.query(`
        CREATE TABLE IF NOT EXISTS motor_vehicles (
            id INT AUTO_INCREMENT PRIMARY KEY,
            vehicle_no VARCHAR(255) NOT NULL UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
};

// Ensure shops table exists with phone/phone2 columns
const ensureShopsColumns = async () => {
    // Create shops table if missing
    await db.query(`
        CREATE TABLE IF NOT EXISTS shops (
            id INT AUTO_INCREMENT PRIMARY KEY,
            order_line_id INT NOT NULL DEFAULT 0,
            shop_name VARCHAR(150) NOT NULL,
            village_name VARCHAR(150) DEFAULT '',
            owner_name VARCHAR(100) DEFAULT '',
            shop_owner VARCHAR(100) DEFAULT '',
            phone VARCHAR(20) DEFAULT '',
            phone2 VARCHAR(20) DEFAULT '',
            balance DECIMAL(10,2) DEFAULT 0.00,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    // Safely add columns if they don't exist yet
    const safeAddColumn = async (col, definition) => {
        try {
            await db.query(`ALTER TABLE shops ADD COLUMN ${col} ${definition}`);
        } catch (e) {
            if (e.errno !== 1060) console.warn('ensureShopsColumns:', e.message);
        }
    };
    await safeAddColumn('village_name', "VARCHAR(150) DEFAULT '' AFTER shop_name");
    await safeAddColumn('shop_owner',   "VARCHAR(100) DEFAULT '' AFTER owner_name");
    await safeAddColumn('phone',        "VARCHAR(20)  DEFAULT '' AFTER shop_owner");
    await safeAddColumn('phone2',       "VARCHAR(20)  DEFAULT '' AFTER phone");
};


// GET /api/settings/invoice
exports.getInvoiceSettings = async (req, res) => {
    try {
        await ensureSettings();
        await ensureShopsColumns(); // ensure phone/phone2 columns exist in shops
        const [rows] = await db.query('SELECT next_invoice_no, last_invoice_no FROM app_settings WHERE id = 1');
        res.json(rows[0]);
    } catch (err) {
        console.error('Error getting invoice settings:', err);
        res.status(500).json({ error: 'Failed to get invoice settings' });
    }
};

// PUT /api/settings/invoice
// Body: { next_invoice_no, last_invoice_no }
exports.updateInvoiceSettings = async (req, res) => {
    const { next_invoice_no, last_invoice_no } = req.body;
    try {
        await ensureSettings();
        const fields = [];
        const values = [];
        if (next_invoice_no !== undefined) { fields.push('next_invoice_no = ?'); values.push(next_invoice_no); }
        if (last_invoice_no !== undefined) { fields.push('last_invoice_no = ?'); values.push(last_invoice_no); }
        if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
        await db.query(`UPDATE app_settings SET ${fields.join(', ')} WHERE id = 1`, values);
        res.json({ message: 'Invoice settings updated' });
    } catch (err) {
        console.error('Error updating invoice settings:', err);
        res.status(500).json({ error: 'Failed to update invoice settings' });
    }
};

// GET /api/settings/vehicles
exports.getMotorVehicles = async (req, res) => {
    try {
        await ensureMotorVehiclesTable();
        const [rows] = await db.query('SELECT * FROM motor_vehicles ORDER BY created_at DESC');
        res.json(rows);
    } catch (err) {
        console.error('Error getting motor vehicles:', err);
        res.status(500).json({ error: 'Failed to get motor vehicles' });
    }
};

// POST /api/settings/vehicles
// Body: { vehicle_no }
exports.addMotorVehicle = async (req, res) => {
    const { vehicle_no } = req.body;
    if (!vehicle_no) return res.status(400).json({ error: 'vehicle_no is required' });
    try {
        await ensureMotorVehiclesTable();
        const [result] = await db.query('INSERT INTO motor_vehicles (vehicle_no) VALUES (?)', [vehicle_no]);
        res.json({ id: result.insertId, vehicle_no, message: 'Motor vehicle added successfully' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Motor vehicle already exists' });
        }
        console.error('Error adding motor vehicle:', err);
        res.status(500).json({ error: 'Failed to add motor vehicle' });
    }
};

// DELETE /api/settings/vehicles/:id
exports.deleteMotorVehicle = async (req, res) => {
    const { id } = req.params;
    try {
        await ensureMotorVehiclesTable();
        await db.query('DELETE FROM motor_vehicles WHERE id = ?', [id]);
        res.json({ message: 'Motor vehicle deleted successfully' });
    } catch (err) {
        console.error('Error deleting motor vehicle:', err);
        res.status(500).json({ error: 'Failed to delete motor vehicle' });
    }
};
