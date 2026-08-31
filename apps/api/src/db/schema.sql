PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'dispatcher'
        CHECK (role IN ('dispatcher', 'viewer')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (company_id)
        REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    license_plate TEXT NOT NULL,
    driver_name TEXT NOT NULL,
    fuel_level REAL NOT NULL DEFAULT 100
        CHECK (fuel_level >= 0 AND fuel_level <= 100),
    status TEXT NOT NULL DEFAULT 'IDLE'
        CHECK (status IN ('IDLE', 'DRIVING', 'STOPPED', 'OFFLINE')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_telemetry_id INTEGER,
    active_alerts INTEGER NOT NULL DEFAULT 0,
    search_text TEXT GENERATED ALWAYS AS (
        lower(license_plate || ' ' || driver_name)
    ) VIRTUAL,

    FOREIGN KEY (company_id)
        REFERENCES companies(id),

    UNIQUE (company_id, license_plate)
);

CREATE TABLE IF NOT EXISTS telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    speed REAL NOT NULL,
    recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (vehicle_id)
        REFERENCES vehicles(id)
        ON DELETE CASCADE
);

-- Eine Fahrt hält den gefahrenen Verlauf dauerhaft als Encoded Polyline.
-- Damit hängt die sichtbare Strecke an der Fahrt und nicht an der Anzahl
-- gespeicherter Rohpunkte: eine Zeile trägt auch 500 km.
-- Geschlossene Fahrten älter als TRIP_RETENTION_DAYS werden pro Firma gelöscht
-- (Join über vehicles, kein company_id hier).
CREATE TABLE IF NOT EXISTS trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TEXT,
    path TEXT NOT NULL DEFAULT '',
    point_count INTEGER NOT NULL DEFAULT 0,
    distance_m REAL NOT NULL DEFAULT 0,
    max_speed REAL NOT NULL DEFAULT 0,

    -- Letzter kodierter Punkt. Die Polyline speichert Deltas, deshalb braucht
    -- das Anhängen den Vorgänger, ohne den ganzen Verlauf zu dekodieren.
    last_latitude REAL,
    last_longitude REAL,

    FOREIGN KEY (vehicle_id)
        REFERENCES vehicles(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    severity TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT,

    FOREIGN KEY (vehicle_id)
        REFERENCES vehicles(id)
        ON DELETE CASCADE
);
