import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config";
import { migrate } from "./migrate";

const schemaPath = join(__dirname, "schema.sql");
const isMemoryDatabase = config.databasePath === ":memory:";

if (!isMemoryDatabase) {
    mkdirSync(dirname(config.databasePath), { recursive: true });
}

export const db = new DatabaseSync(config.databasePath);

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

export function closeDatabase() {
    try {
        db.exec("PRAGMA optimize");
    } catch {
        // Schließen ist wichtiger als der letzte ANALYZE-Lauf.
    }

    db.close();
}
