PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    import_prompt_dismissed_at TEXT,
    totp_required INTEGER NOT NULL DEFAULT 0,
    due_lead_days INTEGER,
    licence_check_months INTEGER,
    sso_issuer TEXT,
    sso_client_id TEXT,
    sso_client_secret TEXT,
    sso_required INTEGER NOT NULL DEFAULT 0,
    -- Retention in days set by the company; NULL is the default (shared RETENTION_*).
    trip_retention_days INTEGER,
    alert_retention_days INTEGER,
    audit_retention_days INTEGER,
    -- 0: driver names on warnings, trips and the driver pages are for dispatchers only.
    viewer_driver_names INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_name_nocase
    ON companies(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    email_verified_at TEXT,
    totp_secret TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    totp_last_step INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS company_memberships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    company_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('dispatcher', 'viewer')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    FOREIGN KEY (company_id)
        REFERENCES companies(id),

    UNIQUE (user_id, company_id)
);

-- An invitation is not a membership: it becomes one only when the invited
-- person accepts it (the link in the mail, or Konto → Firmen when signed in).
CREATE TABLE IF NOT EXISTS company_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('dispatcher', 'viewer')),
    invited_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (company_id)
        REFERENCES companies(id)
        ON DELETE CASCADE,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    FOREIGN KEY (invited_by)
        REFERENCES users(id)
        ON DELETE SET NULL,

    UNIQUE (company_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_company_invites_user
    ON company_invites(user_id);

-- Who changed access to a company: invitations, roles, removals, sign-in rules.
-- Names and the address are copied at the time, so a deleted or renamed
-- account still reads as it was.
CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    actor_user_id INTEGER,
    actor_name TEXT,
    target_user_id INTEGER,
    target_name TEXT,
    target_email TEXT,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (company_id)
        REFERENCES companies(id)
        ON DELETE CASCADE,

    FOREIGN KEY (actor_user_id)
        REFERENCES users(id)
        ON DELETE SET NULL,

    FOREIGN KEY (target_user_id)
        REFERENCES users(id)
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_company
    ON audit_events(company_id, id);

-- A domain a company proves with a DNS TXT record. The company login is
-- found by the e-mail's domain, only for a confirmed one.
CREATE TABLE IF NOT EXISTS company_domains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    domain TEXT NOT NULL,
    token TEXT NOT NULL,
    verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (company_id)
        REFERENCES companies(id)
        ON DELETE CASCADE,

    UNIQUE (company_id, domain)
);

-- Several companies may claim a domain; only one can prove it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_domains_verified
    ON company_domains(domain)
    WHERE verified_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    company_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    persistent INTEGER NOT NULL DEFAULT 0,
    -- The session passed a second factor (TOTP or a recovery code).
    mfa INTEGER NOT NULL DEFAULT 0,
    -- Set when a company login (OIDC) opened the session; it then stays in that company.
    sso_company_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    FOREIGN KEY (company_id)
        REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS auth_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    purpose TEXT NOT NULL CHECK (purpose IN (
        'verify_email',
        'reset_password',
        'invite',
        'login_challenge',
        'totp_setup',
        'sso_state',
        'sso_link'
    )),
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    company_id INTEGER,
    role TEXT,
    payload TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS totp_recovery_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    code_hash TEXT NOT NULL,
    used_at TEXT,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

-- An external login, keyed by the validated issuer and subject of its ID token.
-- `provider` is where it was linked (google, microsoft, company:<id>); a row is
-- only written by an explicit link of the signed-in owner, never by e-mail.
CREATE TABLE IF NOT EXISTS sso_identities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    issuer TEXT NOT NULL CHECK (issuer <> ''),
    subject TEXT NOT NULL CHECK (subject <> ''),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    UNIQUE (provider, issuer, subject)
);

CREATE TABLE IF NOT EXISTS drivers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (company_id)
        REFERENCES companies(id),

    UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    current_driver_id INTEGER,
    license_plate TEXT NOT NULL,
    driver_name TEXT,
    fuel_level REAL NOT NULL DEFAULT 100
        CHECK (fuel_level >= 0 AND fuel_level <= 100),
    status TEXT NOT NULL DEFAULT 'IDLE'
        CHECK (status IN ('IDLE', 'DRIVING', 'STOPPED', 'OFFLINE')),
    vin TEXT,
    vehicle_type TEXT
        CHECK (vehicle_type IS NULL OR vehicle_type IN (
            'TRUCK', 'VAN', 'CAR', 'TRAILER', 'OTHER'
        )),
    hu_due_on TEXT,
    hu_due_on_legacy TEXT,
    uvv_due_on TEXT,
    uvv_checked_on TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    depot TEXT,
    cost_center TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_telemetry_id INTEGER,
    active_alerts INTEGER NOT NULL DEFAULT 0,
    speed_limit_kmh REAL,
    -- Set by the dispatcher: not given to drivers until set back (NULL = in service).
    out_of_service_since TEXT,
    search_text TEXT GENERATED ALWAYS AS (
        lower(license_plate || ' ' || coalesce(driver_name, ''))
    ) VIRTUAL,

    FOREIGN KEY (company_id)
        REFERENCES companies(id),

    FOREIGN KEY (current_driver_id)
        REFERENCES drivers(id),

    UNIQUE (company_id, license_plate)
);

CREATE TABLE IF NOT EXISTS driver_vehicles (
    driver_id INTEGER NOT NULL,
    vehicle_id INTEGER NOT NULL,

    PRIMARY KEY (driver_id, vehicle_id),

    FOREIGN KEY (driver_id)
        REFERENCES drivers(id),

    FOREIGN KEY (vehicle_id)
        REFERENCES vehicles(id)
        ON DELETE CASCADE
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

-- Monatssumme gefahrener Meter pro Firma. Bleibt stehen, wenn alte Trips
-- (Pfad) gelöscht werden. Eine Zeile pro Firma und Monat.
CREATE TABLE IF NOT EXISTS trip_month_km (
    company_id INTEGER NOT NULL,
    month TEXT NOT NULL,
    distance_m REAL NOT NULL DEFAULT 0,

    PRIMARY KEY (company_id, month),
    FOREIGN KEY (company_id)
        REFERENCES companies(id)
        ON DELETE CASCADE
);

-- Monatssummen der Warnungen pro Firma. Die Zeilen selbst werden nach
-- ALERT_RETENTION_DAYS gelöscht; die Schicht-Diagramme lesen alte Monate hier.
CREATE TABLE IF NOT EXISTS alert_month_stats (
    company_id INTEGER NOT NULL,
    month TEXT NOT NULL,
    speeding_drivers INTEGER NOT NULL DEFAULT 0,
    speeding_events INTEGER NOT NULL DEFAULT 0,
    speeding_high INTEGER NOT NULL DEFAULT 0,
    low_fuel_vehicles INTEGER NOT NULL DEFAULT 0,
    offline_vehicles INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (company_id, month),
    FOREIGN KEY (company_id)
        REFERENCES companies(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL,
    driver_id INTEGER,
    type TEXT NOT NULL,
    severity TEXT NOT NULL,
    message TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TEXT,
    resolved_at TEXT,

    FOREIGN KEY (vehicle_id)
        REFERENCES vehicles(id)
        ON DELETE CASCADE,

    FOREIGN KEY (driver_id)
        REFERENCES drivers(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_open_per_type
    ON alerts(vehicle_id, type)
    WHERE ended_at IS NULL;

-- A vehicle's stay in a workshop: planned, there, finished or cancelled.
-- No company_id: access is visit → vehicle → company, like alerts.
CREATE TABLE IF NOT EXISTS workshop_visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL,
    reason TEXT NOT NULL
        CHECK (reason IN ('HU', 'UVV', 'MAINTENANCE', 'DAMAGE', 'OTHER')),
    state TEXT NOT NULL
        CHECK (state IN ('PLANNED', 'IN_WORKSHOP', 'DONE', 'CANCELLED')),
    place TEXT NOT NULL,
    planned_on TEXT NOT NULL,
    expected_on TEXT,
    assignee_user_id INTEGER,
    note TEXT,
    -- Day it got there (Europe/Berlin); the event log keeps the time.
    arrived_on TEXT,
    finished_on TEXT,
    cost_cents INTEGER,
    result_note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (vehicle_id)
        REFERENCES vehicles(id)
        ON DELETE CASCADE,

    FOREIGN KEY (assignee_user_id)
        REFERENCES users(id)
        ON DELETE SET NULL
);

-- At most one open stay per vehicle.
CREATE UNIQUE INDEX IF NOT EXISTS idx_workshop_visits_open
    ON workshop_visits(vehicle_id)
    WHERE state IN ('PLANNED', 'IN_WORKSHOP');

CREATE INDEX IF NOT EXISTS idx_workshop_visits_vehicle
    ON workshop_visits(vehicle_id, id);

-- Every change of a stay; the name is copied, so a deleted account still reads.
CREATE TABLE IF NOT EXISTS workshop_visit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visit_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    actor_user_id INTEGER,
    actor_name TEXT,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (visit_id)
        REFERENCES workshop_visits(id)
        ON DELETE CASCADE,

    FOREIGN KEY (actor_user_id)
        REFERENCES users(id)
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_workshop_visit_events_visit
    ON workshop_visit_events(visit_id, id);

-- Ein Profil pro Firma: Spalten- und Statuszuordnung der letzten Exporte.
CREATE TABLE IF NOT EXISTS import_mapping_profiles (
    company_id INTEGER PRIMARY KEY,
    sheet_mappings TEXT NOT NULL,
    status_mapping TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (company_id)
        REFERENCES companies(id)
);

-- Protokoll erfolgreicher Commits (wer, wann, Zähler).
CREATE TABLE IF NOT EXISTS import_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    source TEXT NOT NULL
        CHECK (source IN ('csv', 'xlsx')),
    created_vehicles INTEGER NOT NULL,
    updated_vehicles INTEGER NOT NULL,
    created_drivers INTEGER NOT NULL,
    assigned_eligibility INTEGER NOT NULL,
    set_current INTEGER NOT NULL,
    skipped_rows INTEGER NOT NULL,
    failed_rows INTEGER NOT NULL,
    warning_count INTEGER NOT NULL DEFAULT 0,

    FOREIGN KEY (company_id)
        REFERENCES companies(id),

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_import_runs_company_created
    ON import_runs(company_id, created_at DESC, id DESC);
