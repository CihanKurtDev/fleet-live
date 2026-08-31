/**
 * Eine Fahrt ist der dauerhafte Streckenverlauf, solange das Fahrzeug
 * `DRIVING` ist. Der Verlauf liegt als Encoded Polyline vor, damit er
 * unabhängig von der Streckenlänge in einer Zeile und einem Request passt —
 * Telemetriepunkte sind nur der kurzlebige Puffer für die Live-Position.
 */
export type Trip = {
    id: number;
    vehicle_id: number;
    started_at: string;
    /** `null`, solange die Fahrt läuft. */
    ended_at: string | null;
    /** Encoded Polyline, Präzision 5. Leer, bis der erste Punkt gemeldet ist. */
    path: string;
    /** Stützpunkte in `path`. */
    point_count: number;
    /** Summe der gemeldeten Teilstrecken, nicht die Länge der vereinfachten Linie. */
    distance_m: number;
    max_speed: number;
};

export type TripResponse = {
    /** `null`, wenn das Fahrzeug noch nie gefahren ist. */
    data: Trip | null;
};
