/**
 * Zeitstempel im Format von SQLites `CURRENT_TIMESTAMP`: UTC ohne Zone.
 * Damit sind selbst geschriebene und von der Datenbank gesetzte Werte
 * vergleichbar und sortierbar.
 */
export function nowSqlite(): string {
    return new Date().toISOString().slice(0, 19).replace("T", " ");
}
