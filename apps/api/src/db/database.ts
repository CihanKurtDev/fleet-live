import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const dataDirectory = join(process.cwd(), "data");
const databasePath = join(dataDirectory, "fleetlive.db");
const schemaPath = join(__dirname, "schema.sql");

mkdirSync(dataDirectory, { recursive: true });

export const db = new DatabaseSync(databasePath);

db.exec("PRAGMA foreign_keys = ON");

const schema = readFileSync(schemaPath, "utf8");

db.exec(schema);