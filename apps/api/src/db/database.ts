import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
    berlinTodayIso,
    resolveDueSettings,
    vehicleDeadlineState,
    vehicleDeadlines,
} from "@fleet-live/shared";
import { config } from "../config";
import { ensureDevAccounts } from "./devAccounts";
import { migrate } from "./migrate";

const schemaPath = join(__dirname, "schema.sql");
const isMemoryDatabase = config.databasePath === ":memory:";

if (!isMemoryDatabase) {
    mkdirSync(dirname(config.databasePath), { recursive: true });
}

export const db = new DatabaseSync(config.databasePath);

// Today in Europe/Berlin for SQL, the same day `GET /api/due` counts with
// (workshop stays due today). Not deterministic: it changes at midnight.
db.function("berlin_today", { deterministic: false }, () => berlinTodayIso());

// HU/UVV of a vehicle by the rule of /fristen (shared), so the vehicle list
// marks, filters and counts with the same rule the page draws. `kind` 'HU' or
// 'UVV' gives that one's state ('overdue', 'soon', 'ok', 'missing'); 'ANY'
// gives 'overdue', 'soon' or NULL for the filters. The last argument is the
// company's lead (NULL = the catalog's).
db.function(
    "vehicle_deadline",
    { deterministic: false },
    (kind, huDueOn, uvvDueOn, uvvCheckedOn, leadDays) => {
        const vehicle = {
            hu_due_on: typeof huDueOn === "string" ? huDueOn : null,
            uvv_due_on: typeof uvvDueOn === "string" ? uvvDueOn : null,
            uvv_checked_on: typeof uvvCheckedOn === "string" ? uvvCheckedOn : null,
        };
        const lead = resolveDueSettings({
            due_lead_days: leadDays === null ? null : Number(leadDays),
        }).lead_days;

        if (kind === "ANY") {
            return vehicleDeadlineState(vehicle, berlinTodayIso(), lead);
        }

        return (
            vehicleDeadlines(vehicle, berlinTodayIso(), lead).find(
                (deadline) => deadline.reason === kind,
            )?.state ?? null
        );
    },
);

let transactionDepth = 0;

/** Nested calls join the outer transaction instead of issuing a second BEGIN. */
export function withTransaction<T>(fn: () => T): T {
    if (transactionDepth > 0) {
        return fn();
    }

    db.exec("BEGIN");
    transactionDepth = 1;
    try {
        const result = fn();
        db.exec("COMMIT");
        return result;
    } catch (error) {
        try {
            db.exec("ROLLBACK");
        } catch {
            // SQLite may already have rolled back.
        }
        throw error;
    } finally {
        transactionDepth = 0;
    }
}

// busy_timeout zuerst: der WAL-Switch braucht kurz einen Exclusive-Lock,
// und der Busy-Handler muss zu dem Zeitpunkt schon scharf sein.
db.exec("PRAGMA busy_timeout = 5000");
db.exec("PRAGMA foreign_keys = ON");

if (!isMemoryDatabase) {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec("PRAGMA mmap_size = 268435456");
    db.exec("PRAGMA journal_size_limit = 67108864");
}

db.exec("PRAGMA cache_size = -65536");
db.exec("PRAGMA temp_store = MEMORY");
db.exec("PRAGMA optimize = 0x10002");

const schema = readFileSync(schemaPath, "utf8");
db.exec(schema);
migrate(db);

// Accounts with a known password only when asked for (`ALLOW_DEMO_ACCOUNTS`,
// set in dev.env), not for every process that is not production.
if (
    config.allowDemoAccounts &&
    !config.isTest &&
    !config.isProduction &&
    !isMemoryDatabase
) {
    ensureDevAccounts(db);
}

export function closeDatabase() {
    try {
        db.exec("PRAGMA optimize");
    } catch {
        // Schließen ist wichtiger als der letzte ANALYZE-Lauf.
    }

    db.close();
}
