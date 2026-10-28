/**
 * Eine Fahrt ist der dauerhafte Streckenverlauf, solange das Fahrzeug
 * `DRIVING` ist. Der Verlauf liegt als Encoded Polyline vor, damit er
 * unabhängig von der Streckenlänge in einer Zeile und einem Request passt —
 * Telemetriepunkte sind nur der kurzlebige Puffer für die Live-Position.
 */
/** Listenzeile ohne Verlauf — der Path kommt nur bei Einzelabruf. */
export type TripListItem = {
    id: number;
    vehicle_id: number;
    started_at: string;
    /** `null`, solange die Fahrt läuft. */
    ended_at: string | null;
    /** Stützpunkte in `path` (auch ohne den String in der Liste). */
    point_count: number;
    /** Summe der gemeldeten Teilstrecken, nicht die Länge der vereinfachten Linie. */
    distance_m: number;
    max_speed: number;
    /** Wer gefahren ist (Stand bei Fahrtbeginn); `null` bei älteren Fahrten ohne Angabe. */
    driver_id: number | null;
    driver_name: string | null;
    /** Wie oft das Fahrzeug auf dieser Fahrt über dem Limit war. */
    speeding_count: number;
    /** Funklöcher während der Fahrt. */
    offline_count: number;
};

export const TRIP_EVENT_TYPES = ["SPEEDING", "OFFLINE"] as const;
export type TripEventType = (typeof TRIP_EVENT_TYPES)[number];

/**
 * Was auf der Fahrt passiert ist und wo: jede Überschreitung des Limits und
 * jedes Funkloch. Die Stelle sind Meter ab Fahrtbeginn im selben Maß wie
 * `distance_m`; die Karte legt sie über ihren Anteil auf die Linie.
 */
export type TripEvent = {
    id: number;
    type: TripEventType;
    started_at: string;
    /** `null`, solange es läuft. */
    ended_at: string | null;
    from_m: number;
    /** Ende der Überschreitung; Funkloch: dieselbe Stelle. `null` solange offen oder geschätzt. */
    to_m: number | null;
    /** Tempo: Spitze und das Limit der Straße. */
    max_speed_kmh: number | null;
    limit_kmh: number | null;
    /** Ältere Fahrt: Stelle aus der Uhrzeit der Warnung geschätzt, ohne Strecke. */
    estimated: boolean;
    /** Wie viele Überschreitungen dieser Eintrag zusammenfasst (geschätzt: die ganze Warnung). */
    count: number;
    /** Die Warnung im Eingang (Tempo: eine je Fahrt); `null`, wenn sie gelöscht ist. */
    alert_id: number | null;
    /** Die Warnung ist noch nicht erledigt. */
    alert_open: boolean;
};

export type Trip = TripListItem & {
    /** Encoded Polyline, Präzision 5. Leer, bis der erste Punkt gemeldet ist. */
    path: string;
    /** Nach der Stelle auf der Fahrt sortiert. */
    events: TripEvent[];
};

export type TripResponse = {
    /** `null`, wenn das Fahrzeug noch nie gefahren ist. */
    data: Trip | null;
};
