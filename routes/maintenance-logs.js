const express = require('express');
const router = express.Router();
const { getDb } = require('../database/init');

// Helper to calculate difference in months between two dates
function monthDiff(d1, d2) {
    let months;
    months = (d2.getFullYear() - d1.getFullYear()) * 12;
    months -= d1.getMonth();
    months += d2.getMonth();
    return months <= 0 ? 0 : months;
}

function checkVehicleOwnership(db, vehicleId, userId) {
    const v = db.prepare('SELECT id FROM vehicles WHERE id = ? AND user_id = ?').get(vehicleId, userId);
    return !!v;
}

function checkLogOwnership(db, logId, userId) {
    const log = db.prepare(`
        SELECT ml.id 
        FROM maintenance_logs ml
        JOIN vehicles v ON ml.vehicle_id = v.id
        WHERE ml.id = ? AND v.user_id = ?
    `).get(logId, userId);
    return !!log;
}

// GET /api/vehicles/:vehicleId/maintenance
router.get('/vehicles/:vehicleId/maintenance', (req, res) => {
    const { type_id } = req.query;
    try {
        const db = getDb();
        if (!checkVehicleOwnership(db, req.params.vehicleId, req.user.id)) {
            return res.status(403).json({ error: 'Tidak diizinkan' });
        }

        let query = `
            SELECT ml.*, mt.name, mt.icon, mt.category 
            FROM maintenance_logs ml
            JOIN maintenance_types mt ON ml.maintenance_type_id = mt.id
            WHERE ml.vehicle_id = ?
        `;
        const params = [req.params.vehicleId];
        
        if (type_id) {
            query += " AND ml.maintenance_type_id = ?";
            params.push(type_id);
        }
        query += " ORDER BY ml.log_date DESC, ml.id DESC";
        
        const logs = db.prepare(query).all(...params);
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/vehicles/:vehicleId/maintenance
router.post('/vehicles/:vehicleId/maintenance', (req, res) => {
    const { maintenance_type_id, log_date, odometer, workshop, cost, parts_used, notes } = req.body;
    const vehicleId = req.params.vehicleId;
    
    try {
        const db = getDb();
        if (!checkVehicleOwnership(db, vehicleId, req.user.id)) {
            return res.status(403).json({ error: 'Tidak diizinkan' });
        }

        db.transaction(() => {
            const insert = db.prepare(`
                INSERT INTO maintenance_logs (vehicle_id, maintenance_type_id, log_date, odometer, workshop, cost, parts_used, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const info = insert.run(vehicleId, maintenance_type_id, log_date, odometer, workshop, cost || 0, parts_used, notes);
            
            // Update vehicle current_odometer if higher
            const vehicle = db.prepare('SELECT current_odometer FROM vehicles WHERE id = ?').get(vehicleId);
            if (vehicle && odometer > vehicle.current_odometer) {
                db.prepare('UPDATE vehicles SET current_odometer = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                  .run(odometer, vehicleId);
            }
            return info.lastInsertRowid;
        })();
        
        res.status(201).json({ message: 'Log perawatan berhasil ditambahkan' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/maintenance/:id
router.put('/maintenance/:id', (req, res) => {
    const { log_date, odometer, workshop, cost, parts_used, notes } = req.body;
    try {
        const db = getDb();
        if (!checkLogOwnership(db, req.params.id, req.user.id)) {
            return res.status(403).json({ error: 'Tidak diizinkan' });
        }

        const update = db.prepare(`
            UPDATE maintenance_logs 
            SET log_date = ?, odometer = ?, workshop = ?, cost = ?, parts_used = ?, notes = ?
            WHERE id = ?
        `);
        const info = update.run(log_date, odometer, workshop, cost, parts_used, notes, req.params.id);
        if (info.changes === 0) return res.status(404).json({ error: 'Log tidak ditemukan' });
        
        res.json({ message: 'Log perawatan berhasil diupdate' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/maintenance/:id
router.delete('/maintenance/:id', (req, res) => {
    try {
        const db = getDb();
        if (!checkLogOwnership(db, req.params.id, req.user.id)) {
            return res.status(403).json({ error: 'Tidak diizinkan' });
        }

        const info = db.prepare('DELETE FROM maintenance_logs WHERE id = ?').run(req.params.id);
        if (info.changes === 0) return res.status(404).json({ error: 'Log tidak ditemukan' });
        res.json({ message: 'Log perawatan berhasil dihapus' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/reminders
router.get('/reminders', (req, res) => {
    const { vehicle_id } = req.query;
    try {
        const db = getDb();
        let vehiclesQuery = 'SELECT id, name, type, plate_number, current_odometer, created_at FROM vehicles WHERE user_id = ?';
        const vehiclesParams = [req.user.id];
        
        if (vehicle_id) {
            vehiclesQuery += ' AND id = ?';
            vehiclesParams.push(vehicle_id);
        }
        
        const vehicles = db.prepare(vehiclesQuery).all(...vehiclesParams);
        const results = [];
        const today = new Date();
        
        for (const vehicle of vehicles) {
            const settings = db.prepare(`
                SELECT vms.*, mt.name, mt.icon, mt.category, mt.default_interval_km, mt.default_interval_months 
                FROM vehicle_maintenance_settings vms
                JOIN maintenance_types mt ON vms.maintenance_type_id = mt.id
                WHERE vms.vehicle_id = ? AND vms.is_enabled = 1
            `).all(vehicle.id);
            
            for (const setting of settings) {
                const interval_km = setting.interval_km !== null ? setting.interval_km : setting.default_interval_km;
                const interval_months = setting.interval_months !== null ? setting.interval_months : setting.default_interval_months;
                
                const lastLog = db.prepare(`
                    SELECT log_date, odometer FROM maintenance_logs 
                    WHERE vehicle_id = ? AND maintenance_type_id = ? 
                    ORDER BY log_date DESC, id DESC LIMIT 1
                `).get(vehicle.id, setting.maintenance_type_id);
                
                let km_elapsed, months_elapsed, start_date, start_odometer;
                
                if (lastLog) {
                    start_date = new Date(lastLog.log_date);
                    start_odometer = lastLog.odometer;
                } else {
                    start_date = new Date(vehicle.created_at);
                    start_odometer = 0;
                }
                
                km_elapsed = vehicle.current_odometer - start_odometer;
                if (km_elapsed < 0) km_elapsed = 0;
                
                months_elapsed = monthDiff(start_date, today);
                
                let status = 'ok';
                let km_remaining = interval_km ? interval_km - km_elapsed : null;
                let months_remaining = interval_months ? interval_months - months_elapsed : null;
                
                let next_due_km = interval_km ? start_odometer + interval_km : null;
                let next_due_date = null;
                if (interval_months) {
                    let d = new Date(start_date);
                    d.setMonth(d.getMonth() + interval_months);
                    next_due_date = d.toISOString().split('T')[0];
                }

                if ((interval_km && km_elapsed >= interval_km) || (interval_months && months_elapsed >= interval_months)) {
                    status = 'overdue';
                } else if ((interval_km && km_remaining <= 0.25 * interval_km) || (interval_months && months_remaining <= 1)) {
                    status = 'due_soon';
                } else if (!lastLog && ((interval_km && km_elapsed < 0.25 * interval_km) || (interval_months && months_elapsed < 1))) {
                    status = 'no_data';
                }
                
                results.push({
                    vehicle: { id: vehicle.id, name: vehicle.name, plate_number: vehicle.plate_number, current_odometer: vehicle.current_odometer },
                    maintenance_type: { id: setting.maintenance_type_id, name: setting.name, icon: setting.icon, category: setting.category },
                    status,
                    km_remaining,
                    months_remaining,
                    last_log: lastLog || null,
                    next_due_km,
                    next_due_date
                });
            }
        }
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/vehicles/:vehicleId/settings
router.get('/vehicles/:vehicleId/settings', (req, res) => {
    try {
        const db = getDb();
        if (!checkVehicleOwnership(db, req.params.vehicleId, req.user.id)) {
            return res.status(403).json({ error: 'Tidak diizinkan' });
        }

        const settings = db.prepare(`
            SELECT vms.*, mt.name, mt.icon, mt.category, mt.default_interval_km, mt.default_interval_months 
            FROM vehicle_maintenance_settings vms
            JOIN maintenance_types mt ON vms.maintenance_type_id = mt.id
            WHERE vms.vehicle_id = ?
        `).all(req.params.vehicleId);
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/vehicles/:vehicleId/settings
router.put('/vehicles/:vehicleId/settings', (req, res) => {
    const settings = req.body; 
    const vehicleId = req.params.vehicleId;
    
    try {
        const db = getDb();
        if (!checkVehicleOwnership(db, vehicleId, req.user.id)) {
            return res.status(403).json({ error: 'Tidak diizinkan' });
        }
        
        db.transaction(() => {
            const check = db.prepare('SELECT id FROM vehicle_maintenance_settings WHERE vehicle_id = ? AND maintenance_type_id = ?');
            const insert = db.prepare(`
                INSERT INTO vehicle_maintenance_settings (vehicle_id, maintenance_type_id, interval_km, interval_months, is_enabled)
                VALUES (?, ?, ?, ?, ?)
            `);
            const update = db.prepare(`
                UPDATE vehicle_maintenance_settings 
                SET interval_km = ?, interval_months = ?, is_enabled = ?
                WHERE vehicle_id = ? AND maintenance_type_id = ?
            `);
            
            for (const s of settings) {
                const existing = check.get(vehicleId, s.maintenance_type_id);
                if (existing) {
                    update.run(s.interval_km, s.interval_months, s.is_enabled, vehicleId, s.maintenance_type_id);
                } else {
                    insert.run(vehicleId, s.maintenance_type_id, s.interval_km, s.interval_months, s.is_enabled);
                }
            }
        })();
        
        res.json({ message: 'Pengaturan berhasil disimpan' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/stats
router.get('/stats', (req, res) => {
    try {
        const db = getDb();
        const totalVehicles = db.prepare('SELECT COUNT(*) as count FROM vehicles WHERE user_id = ?').get(req.user.id).count;
        
        const today = new Date();
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
        
        const costMonthQuery = db.prepare(`
            SELECT SUM(ml.cost) as total 
            FROM maintenance_logs ml
            JOIN vehicles v ON ml.vehicle_id = v.id
            WHERE ml.log_date >= ? AND v.user_id = ?
        `).get(startOfMonth, req.user.id);
        const costMonth = costMonthQuery ? costMonthQuery.total || 0 : 0;
        
        const costAllTimeQuery = db.prepare(`
            SELECT SUM(ml.cost) as total 
            FROM maintenance_logs ml
            JOIN vehicles v ON ml.vehicle_id = v.id
            WHERE v.user_id = ?
        `).get(req.user.id);
        const costAllTime = costAllTimeQuery ? costAllTimeQuery.total || 0 : 0;
        
        const vehicles = db.prepare('SELECT id, created_at, current_odometer FROM vehicles WHERE user_id = ?').all(req.user.id);
        let totalOverdue = 0;
        
        for (const v of vehicles) {
            const settings = db.prepare(`
                SELECT vms.*, mt.default_interval_km, mt.default_interval_months 
                FROM vehicle_maintenance_settings vms
                JOIN maintenance_types mt ON vms.maintenance_type_id = mt.id
                WHERE vms.vehicle_id = ? AND vms.is_enabled = 1
            `).all(v.id);
            
            for (const s of settings) {
                const interval_km = s.interval_km !== null ? s.interval_km : s.default_interval_km;
                const interval_months = s.interval_months !== null ? s.interval_months : s.default_interval_months;
                
                const lastLog = db.prepare(`
                    SELECT log_date, odometer FROM maintenance_logs 
                    WHERE vehicle_id = ? AND maintenance_type_id = ? 
                    ORDER BY log_date DESC, id DESC LIMIT 1
                `).get(v.id, s.maintenance_type_id);
                
                let start_date = lastLog ? new Date(lastLog.log_date) : new Date(v.created_at);
                let start_odometer = lastLog ? lastLog.odometer : 0;
                
                let km_elapsed = v.current_odometer - start_odometer;
                let months_elapsed = monthDiff(start_date, today);
                
                if ((interval_km && km_elapsed >= interval_km) || (interval_months && months_elapsed >= interval_months)) {
                    totalOverdue++;
                }
            }
        }

        res.json({
            total_vehicles: totalVehicles,
            total_overdue_reminders: totalOverdue,
            total_cost_this_month: costMonth,
            total_cost_all_time: costAllTime
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
