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
};

export type Trip = TripListItem & {
    /** Encoded Polyline, Präzision 5. Leer, bis der erste Punkt gemeldet ist. */
    path: string;
};

export type TripResponse = {
    /** `null`, wenn das Fahrzeug noch nie gefahren ist. */
    data: Trip | null;
};
