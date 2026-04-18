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

// GET /api/settings/invoice
exports.getInvoiceSettings = async (req, res) => {
    try {
        await ensureSettings();
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
