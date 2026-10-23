/**
 * Zeitstempel im Format von SQLites `CURRENT_TIMESTAMP`: UTC ohne Zone.
 * Damit sind selbst geschriebene und von der Datenbank gesetzte Werte
 * vergleichbar und sortierbar.
 */
export function nowSqlite(): string {
    return sqliteFromDate(new Date());
}

/**
 * Gerätezeit eines Telemetriepunkts: wie `nowSqlite`, mit Millisekunden
 * (`2026-10-23 10:00:05.250`). Bei Meldeabständen von 3 bis 8 s wären ganze
 * Sekunden bis zu 30 % Fehler im Tempo der Karte. Sortiert und vergleicht
 * wie die Werte ohne Bruchteil; `parseRecordedAt` liest beide.
 */
export function nowSqliteMs(): string {
    return new Date().toISOString().slice(0, 23).replace("T", " ");
}

/** UTC-Zeitstempel im SQLite-Format, `days` Tage vor jetzt. */
export function sqliteDaysAgo(days: number): string {
    return sqliteFromDate(new Date(Date.now() - days * 86_400_000));
}

function sqliteFromDate(date: Date): string {
    return date.toISOString().slice(0, 19).replace("T", " ");
}

export function sqliteFromMs(ms: number): string {
    return sqliteFromDate(new Date(ms));
}
