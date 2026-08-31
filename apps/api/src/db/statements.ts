import type { DatabaseSync } from "node:sqlite";
import { db } from "./database";

type Statement = ReturnType<DatabaseSync["prepare"]>;

const cache = new Map<string, Statement>();

function normalizeSql(sql: string): string {
    return sql.replace(/\s+/g, " ").trim();
}

/**
 * Gibt ein gecachtes Prepared Statement zurück.
 *
 * node:sqlite cacht selbst nicht — jedes `db.prepare` parst SQL neu.
 * Die Listen-Query hat nur endlich viele Varianten (Sort × Filter × Suche),
 * der Cache bleibt deshalb klein und ist nach wenigen Requests warm.
 */
export function stmt(sql: string): Statement {
    const key = normalizeSql(sql);
    let statement = cache.get(key);

    if (!statement) {
        statement = db.prepare(sql);
        cache.set(key, statement);
    }

    return statement;
}
