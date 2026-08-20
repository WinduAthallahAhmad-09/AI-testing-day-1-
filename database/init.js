const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.sqlite');

// ============================================================
// Compatibility wrapper: mimics better-sqlite3 API using sql.js
// ============================================================
class DatabaseWrapper {
    constructor(sqlDb) {
        this._db = sqlDb;
    }

    prepare(sql) {
        const db = this._db;
        const self = this;
        return {
            run(...params) {
                db.run(sql, params);
                const changes = db.getRowsModified();
                const lastRow = db.exec("SELECT last_insert_rowid() as id");
                const lastInsertRowid = lastRow.length > 0 ? lastRow[0].values[0][0] : 0;
                self._save();
                return { changes, lastInsertRowid };
            },
            get(...params) {
                let result = undefined;
                try {
                    const stmt = db.prepare(sql);
                    if (params.length > 0) stmt.bind(params);
                    if (stmt.step()) {
                        result = stmt.getAsObject();
                    }
                    stmt.free();
                } catch (e) {
                    // If the query returns no results, return undefined
                    if (e.message && e.message.includes('no more rows')) return undefined;
                    throw e;
                }
                return result;
            },
            all(...params) {
                const results = [];
                try {
                    const stmt = db.prepare(sql);
                    if (params.length > 0) stmt.bind(params);
                    while (stmt.step()) {
                        results.push(stmt.getAsObject());
                    }
                    stmt.free();
                } catch (e) {
                    if (e.message && e.message.includes('no more rows')) return results;
                    throw e;
                }
                return results;
            }
        };
    }

    exec(sql) {
        this._db.run(sql);
        this._save();
    }

    pragma(str) {
        try {
            this._db.run(`PRAGMA ${str}`);
        } catch (e) {
            // Some pragmas may not be supported in sql.js, ignore silently
            console.warn(`Pragma warning: ${str}`, e.message);
        }
    }

    transaction(fn) {
        const db = this._db;
        const self = this;
        return (...args) => {
            db.run('BEGIN TRANSACTION');
            try {
                const result = fn(...args);
                db.run('COMMIT');
                self._save();
                return result;
            } catch (e) {
                db.run('ROLLBACK');
                throw e;
            }
        };
    }

    _save() {
        try {
            const data = this._db.export();
            const buffer = Buffer.from(data);
            fs.writeFileSync(dbPath, buffer);
        } catch (e) {
            console.error('Failed to save database:', e.message);
        }
    }

    close() {
        this._save();
        this._db.close();
    }
}

// ============================================================
// Module state
// ============================================================
let dbInstance = null;

/**
 * Initialize the database (async, called once at startup)
 */
async function initialize() {
    const SQL = await initSqlJs();

    // Load existing database file or create new
    let db;
    if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath); // Delete the existing database file per instruction
    }
    db = new SQL.Database();

    const wrapper = new DatabaseWrapper(db);

    // Enable foreign keys
    wrapper.pragma('foreign_keys = ON');

    // Create tables
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS vehicles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            plate_number TEXT,
            year INTEGER,
            current_odometer INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS maintenance_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            icon TEXT DEFAULT '🔧',
            default_interval_km INTEGER,
            default_interval_months INTEGER,
            applicable_to TEXT DEFAULT 'semua',
            is_default BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS vehicle_maintenance_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vehicle_id INTEGER NOT NULL,
            maintenance_type_id INTEGER NOT NULL,
            interval_km INTEGER,
            interval_months INTEGER,
            is_enabled BOOLEAN DEFAULT 1,
            FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
            FOREIGN KEY (maintenance_type_id) REFERENCES maintenance_types(id) ON DELETE CASCADE,
            UNIQUE(vehicle_id, maintenance_type_id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS maintenance_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vehicle_id INTEGER NOT NULL,
            maintenance_type_id INTEGER NOT NULL,
            log_date DATE NOT NULL,
            odometer INTEGER NOT NULL,
            workshop TEXT,
            cost INTEGER DEFAULT 0,
            parts_used TEXT,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
            FOREIGN KEY (maintenance_type_id) REFERENCES maintenance_types(id) ON DELETE CASCADE
        )
    `);

    // Seed default maintenance types
    const checkStmt = db.prepare("SELECT COUNT(*) as count FROM maintenance_types WHERE is_default = 1");
    checkStmt.step();
    const count = checkStmt.getAsObject().count;
    checkStmt.free();

    if (count === 0) {
        const defaults = [
            ['Ganti Oli Mesin',       '🛢️', 'Pelumasan',   2000,  3,  'semua'],
            ['Ganti Oli Gardan',      '🛢️', 'Pelumasan',   8000,  6,  'semua'],
            ['Ganti Oli Transmisi',   '🛢️', 'Pelumasan',   20000, 12, 'mobil'],
            ['Servis Rutin / Tune Up','🔧', 'Servis',      5000,  3,  'semua'],
            ['Ganti Filter Udara',    '🔧', 'Servis',      10000, 12, 'semua'],
            ['Ganti Busi',            '🔧', 'Servis',      10000, 12, 'semua'],
            ['Ganti Minyak Rem',      '🛞', 'Rem',         20000, 24, 'semua'],
            ['Ganti Kampas Rem',      '🛞', 'Rem',         15000, 12, 'semua'],
            ['Ganti/Stel Rantai',     '⛓️', 'Penggerak',   5000,  6,  'motor'],
            ['Ganti V-Belt',          '⛓️', 'Penggerak',   15000, 18, 'motor'],
            ['Rotasi / Ganti Ban',    '🛞', 'Ban',         20000, 24, 'semua'],
            ['Ganti Coolant',         '❄️', 'Pendingin',   40000, 24, 'semua'],
            ['Ganti / Cek Aki',       '🔋', 'Kelistrikan', null,  12, 'semua']
        ];

        db.run('BEGIN TRANSACTION');
        for (const [name, icon, category, km, months, applicableTo] of defaults) {
            db.run(
                `INSERT INTO maintenance_types (user_id, name, icon, category, default_interval_km, default_interval_months, applicable_to, is_default)
                 VALUES (NULL, ?, ?, ?, ?, ?, ?, 1)`,
                [name, icon, category, km, months, applicableTo]
            );
        }
        db.run('COMMIT');
        wrapper._save();
    }

    dbInstance = wrapper;
    console.log('✅ Database initialized successfully');
    return wrapper;
}

/**
 * Get the database instance (sync, call after initialize())
 */
function getDb() {
    if (!dbInstance) throw new Error('Database not initialized. Call initialize() first.');
    return dbInstance;
}

module.exports = { initialize, getDb };
