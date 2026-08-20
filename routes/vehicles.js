const express = require('express');
const router = express.Router();
const { getDb } = require('../database/init');

// Helper untuk menghitung status reminder
const getRemindersForVehicle = (vehicleId) => {
    const db = getDb();
    const settings = db.prepare(`
        SELECT 
            vms.maintenance_type_id,
            v.current_odometer,
            v.created_at as vehicle_created_at,
            mt.name as type_name,
            mt.default_interval_km,
            mt.default_interval_months,
            vms.interval_km as custom_interval_km,
            vms.interval_months as custom_interval_months
        FROM vehicle_maintenance_settings vms
        JOIN vehicles v ON vms.vehicle_id = v.id
        JOIN maintenance_types mt ON vms.maintenance_type_id = mt.id
        WHERE vms.vehicle_id = ? AND vms.is_enabled = 1
    `).all(vehicleId);

    let reminderCount = 0;
    const today = new Date();

    for (const setting of settings) {
        const intervalKm = setting.custom_interval_km !== null ? setting.custom_interval_km : setting.default_interval_km;
        const intervalMonths = setting.custom_interval_months !== null ? setting.custom_interval_months : setting.default_interval_months;
        
        const lastLog = db.prepare(`
            SELECT log_date, odometer FROM maintenance_logs 
            WHERE vehicle_id = ? AND maintenance_type_id = ? 
            ORDER BY log_date DESC LIMIT 1
        `).get(vehicleId, setting.maintenance_type_id);

        let lastOdometer = lastLog ? lastLog.odometer : 0;
        let lastDate = lastLog ? new Date(lastLog.log_date) : new Date(setting.vehicle_created_at);
        
        let kmElapsed = setting.current_odometer - lastOdometer;
        let monthsElapsed = (today.getFullYear() - lastDate.getFullYear()) * 12 + today.getMonth() - lastDate.getMonth();
        
        let isOverdue = false;
        let isDueSoon = false;

        if (intervalKm && kmElapsed >= intervalKm) isOverdue = true;
        if (intervalMonths && monthsElapsed >= intervalMonths) isOverdue = true;

        if (!isOverdue) {
            if (intervalKm && (intervalKm - kmElapsed) <= (0.25 * intervalKm)) isDueSoon = true;
            if (intervalMonths && (intervalMonths - monthsElapsed) <= 1) isDueSoon = true;
        }

        if (isOverdue || isDueSoon) {
            reminderCount++;
        }
    }
    return reminderCount;
};

// GET /api/vehicles
router.get('/vehicles', (req, res) => {
    try {
        const db = getDb();
        const vehicles = db.prepare(`
            SELECT 
                v.*, 
                (SELECT MAX(log_date) FROM maintenance_logs WHERE vehicle_id = v.id) as last_maintenance_date
            FROM vehicles v
            WHERE v.user_id = ?
        `).all(req.user.id);
        
        const enhancedVehicles = vehicles.map(v => {
            return {
                ...v,
                reminder_count: getRemindersForVehicle(v.id)
            };
        });
        
        res.json(enhancedVehicles);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/vehicles/:id
router.get('/vehicles/:id', (req, res) => {
    try {
        const db = getDb();
        const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
        if (!vehicle) return res.status(404).json({ error: 'Kendaraan tidak ditemukan' });

        const stats = db.prepare(`
            SELECT 
                COALESCE(SUM(cost), 0) as total_cost,
                COUNT(id) as maintenance_count
            FROM maintenance_logs
            WHERE vehicle_id = ?
        `).get(req.params.id);

        res.json({ ...vehicle, ...stats });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/vehicles
router.post('/vehicles', (req, res) => {
    const { name, type, plate_number, year, current_odometer } = req.body;
    try {
        const db = getDb();
        const info = db.prepare(`
            INSERT INTO vehicles (user_id, name, type, plate_number, year, current_odometer)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(req.user.id, name, type, plate_number, year, current_odometer || 0);
        
        const newVehicleId = info.lastInsertRowid;

        // Auto create vehicle_maintenance_settings
        const types = db.prepare(`
            SELECT id, default_interval_km, default_interval_months 
            FROM maintenance_types 
            WHERE applicable_to = 'semua' OR applicable_to = ?
        `).all(type);

        for (const t of types) {
            db.prepare(`
                INSERT INTO vehicle_maintenance_settings (vehicle_id, maintenance_type_id, interval_km, interval_months)
                VALUES (?, ?, ?, ?)
            `).run(newVehicleId, t.id, t.default_interval_km, t.default_interval_months);
        }

        res.status(201).json({ id: newVehicleId, message: 'Kendaraan berhasil ditambahkan' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/vehicles/:id
router.put('/vehicles/:id', (req, res) => {
    const { name, type, plate_number, year } = req.body;
    try {
        const db = getDb();
        const info = db.prepare(`
            UPDATE vehicles 
            SET name = ?, type = ?, plate_number = ?, year = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ?
        `).run(name, type, plate_number, year, req.params.id, req.user.id);
        
        if (info.changes === 0) return res.status(404).json({ error: 'Kendaraan tidak ditemukan' });
        res.json({ message: 'Kendaraan berhasil diupdate' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/vehicles/:id
router.delete('/vehicles/:id', (req, res) => {
    try {
        const db = getDb();
        const vehicle = db.prepare('SELECT id FROM vehicles WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
        if (!vehicle) return res.status(404).json({ error: 'Kendaraan tidak ditemukan' });

        // Manually delete related records first (sql.js CASCADE may not work)
        db.prepare('DELETE FROM maintenance_logs WHERE vehicle_id = ?').run(req.params.id);
        db.prepare('DELETE FROM vehicle_maintenance_settings WHERE vehicle_id = ?').run(req.params.id);
        const info = db.prepare('DELETE FROM vehicles WHERE id = ?').run(req.params.id);
        if (info.changes === 0) return res.status(404).json({ error: 'Kendaraan tidak ditemukan' });
        res.json({ message: 'Kendaraan berhasil dihapus' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/vehicles/:id/odometer
router.put('/vehicles/:id/odometer', (req, res) => {
    const { current_odometer } = req.body;
    try {
        const db = getDb();
        const info = db.prepare(`
            UPDATE vehicles 
            SET current_odometer = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ?
        `).run(current_odometer, req.params.id, req.user.id);
        
        if (info.changes === 0) return res.status(404).json({ error: 'Kendaraan tidak ditemukan' });
        res.json({ message: 'Odometer berhasil diupdate' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
