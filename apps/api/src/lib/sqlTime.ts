/**
 * Zeitstempel im Format von SQLites `CURRENT_TIMESTAMP`: UTC ohne Zone.
 * Damit sind selbst geschriebene und von der Datenbank gesetzte Werte
 * vergleichbar und sortierbar.
 */
export function nowSqlite(): string {
    return sqliteFromDate(new Date());
}

/** UTC-Zeitstempel im SQLite-Format, `days` Tage vor jetzt. */
export function sqliteDaysAgo(days: number): string {
    return sqliteFromDate(new Date(Date.now() - days * 86_400_000));
}

function sqliteFromDate(date: Date): string {
    return date.toISOString().slice(0, 19).replace("T", " ");
}
