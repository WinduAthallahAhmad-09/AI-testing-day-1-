const express = require('express');
const router = express.Router();
const { getDb } = require('../database/init');

// GET /api/maintenance-types
router.get('/maintenance-types', (req, res) => {
    const { applicable_to } = req.query;
    try {
        const db = getDb();
        let query = 'SELECT * FROM maintenance_types WHERE (is_default = 1 OR user_id = ?)';
        const params = [req.user.id];
        
        if (applicable_to) {
            query += " AND (applicable_to = ? OR applicable_to = 'semua')";
            params.push(applicable_to);
        }
        
        const types = db.prepare(query).all(...params);
        res.json(types);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/maintenance-types
router.post('/maintenance-types', (req, res) => {
    const { name, category, icon, default_interval_km, default_interval_months, applicable_to } = req.body;
    try {
        const db = getDb();
        const info = db.prepare(`
            INSERT INTO maintenance_types (user_id, name, category, icon, default_interval_km, default_interval_months, applicable_to, is_default)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        `).run(
            req.user.id,
            name, 
            category, 
            icon || '🔧', 
            default_interval_km || null, 
            default_interval_months || null, 
            applicable_to || 'semua'
        );
        res.status(201).json({ id: info.lastInsertRowid, message: 'Tipe perawatan berhasil ditambahkan' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/maintenance-types/:id
router.put('/maintenance-types/:id', (req, res) => {
    const { name, category, icon, default_interval_km, default_interval_months, applicable_to } = req.body;
    try {
        const db = getDb();
        const info = db.prepare(`
            UPDATE maintenance_types 
            SET name = ?, category = ?, icon = ?, default_interval_km = ?, default_interval_months = ?, applicable_to = ?
            WHERE id = ? AND user_id = ? AND is_default = 0
        `).run(
            name, category, icon, 
            default_interval_km, default_interval_months, 
            applicable_to, req.params.id, req.user.id
        );
        if (info.changes === 0) return res.status(404).json({ error: 'Tipe perawatan tidak ditemukan' });
        res.json({ message: 'Tipe perawatan berhasil diupdate' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/maintenance-types/:id
router.delete('/maintenance-types/:id', (req, res) => {
    try {
        const db = getDb();
        const type = db.prepare('SELECT is_default, user_id FROM maintenance_types WHERE id = ?').get(req.params.id);
        if (!type) return res.status(404).json({ error: 'Tipe perawatan tidak ditemukan' });
        if (type.is_default) return res.status(400).json({ error: 'Tidak dapat menghapus tipe perawatan bawaan' });
        if (type.user_id !== req.user.id) return res.status(403).json({ error: 'Tidak diizinkan' });

        db.prepare('DELETE FROM maintenance_types WHERE id = ?').run(req.params.id);
        res.json({ message: 'Tipe perawatan berhasil dihapus' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
