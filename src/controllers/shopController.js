const db = require('../config/db');
const { validationResult } = require('express-validator');

// GET all shops for a specific order_line (village)
const getShopsByOrderLine = async (req, res) => {
    const { order_line_id } = req.params;
    try {
        const [shops] = await db.query(
            `SELECT id, order_line_id, shop_name, village_name, owner_name, phone, balance, created_at
             FROM shops WHERE order_line_id = ? ORDER BY shop_name ASC`,
            [order_line_id]
        );
        res.json(shops);
    } catch (err) {
        console.error('getShopsByOrderLine error:', err);
        res.status(500).json({ error: 'Failed to fetch shops' });
    }
};

// GET all shops
const getAllShops = async (req, res) => {
    try {
        const [shops] = await db.query(
            `SELECT s.id, s.order_line_id, s.shop_name, s.village_name, s.owner_name, s.phone, s.balance, s.created_at,
                    ol.name AS ol_village_name, ol.node_id
             FROM shops s
             JOIN order_lines ol ON s.order_line_id = ol.id
             ORDER BY ol.name ASC, s.shop_name ASC`
        );
        res.json(shops);
    } catch (err) {
        console.error('getAllShops error:', err);
        res.status(500).json({ error: 'Failed to fetch shops' });
    }
};

// CREATE a shop
const createShop = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { order_line_id, shop_name, village_name, owner_name, phone, balance } = req.body;
    try {
        const [result] = await db.query(
            `INSERT INTO shops (order_line_id, shop_name, village_name, owner_name, phone, balance) VALUES (?, ?, ?, ?, ?, ?)`,
            [order_line_id, shop_name, village_name || '', owner_name || '', phone || '', balance || 0]
        );
        res.status(201).json({ id: result.insertId, message: 'Shop created successfully' });
    } catch (err) {
        console.error('createShop error:', err);
        res.status(500).json({ error: 'Failed to create shop' });
    }
};

// UPDATE a shop
const updateShop = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { id } = req.params;
    const { shop_name, village_name, owner_name, phone, balance } = req.body;
    try {
        await db.query(
            `UPDATE shops SET shop_name = ?, village_name = ?, owner_name = ?, phone = ?, balance = ? WHERE id = ?`,
            [shop_name, village_name || '', owner_name || '', phone || '', balance || 0, id]
        );
        res.json({ message: 'Shop updated successfully' });
    } catch (err) {
        console.error('updateShop error:', err);
        res.status(500).json({ error: 'Failed to update shop' });
    }
};

// DELETE a shop
const deleteShop = async (req, res) => {
    const { id } = req.params;
    try {
        await db.query(`DELETE FROM shops WHERE id = ?`, [id]);
        res.json({ message: 'Shop deleted successfully' });
    } catch (err) {
        console.error('deleteShop error:', err);
        res.status(500).json({ error: 'Failed to delete shop' });
    }
};

module.exports = { getShopsByOrderLine, getAllShops, createShop, updateShop, deleteShop };
