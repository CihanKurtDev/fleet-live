import { z } from "zod";
import { emptyToUndefined } from "./queryPreprocess";

export const TELEMETRY_HISTORY_LIMITS = [10, 25, 50, 100] as const;

export type TelemetryHistoryLimit = (typeof TELEMETRY_HISTORY_LIMITS)[number];

/** Live-Patch eines Fahrzeugs aus dem Telemetrie-Stream (SSE `telemetry`). */
export const telemetryPatchSchema = z.object({
    id: z
        .number({ error: "Fahrzeug-ID muss eine Zahl sein." })
        .int("Fahrzeug-ID muss eine ganze Zahl sein.")
        .positive("Fahrzeug-ID muss größer als 0 sein."),
    speed: z.number({ error: "Geschwindigkeit muss eine Zahl sein." }),
    latitude: z.number({ error: "Breitengrad muss eine Zahl sein." }),
    longitude: z.number({ error: "Längengrad muss eine Zahl sein." }),
    recorded_at: z.string({ error: "Zeitstempel fehlt." }),
    fuel_level: z.number({ error: "Tankstand muss eine Zahl sein." }),
    /** Aktuelles Sim-Streckenlimit dieses Ticks; steuert SPEEDING und Listenfarbe. */
    speed_limit_kmh: z.number().optional(),
    /** Offenes SPEEDING-Ereignis nach dem Tick, für die Live-Farbe. */
    speeding_open: z.boolean().optional(),
    /**
     * Encoded-Polyline-Suffix der dieses Tick gefahrenen Straßenpunkte.
     * Relativ zum letzten Punkt der offenen Fahrt — an `Trip.path` anhängen,
     * außer `path_reset` ist gesetzt.
     */
    path_delta: z.string().optional(),
    /**
     * Der Suffix gehört zu einer neuen Fahrt. Den bisherigen Verlauf
     * verwerfen, nicht anhängen.
     */
    path_reset: z.literal(true).optional(),
});

export type TelemetryPatch = z.infer<typeof telemetryPatchSchema>;

export const telemetryPatchesSchema = z.array(telemetryPatchSchema);

/**
 * Auf dem Draht dürfen Patches `recorded_at` weglassen, wenn es dem des
 * vorigen Patches im selben Ereignis gleicht (alle Fahrzeuge eines Ticks
 * teilen es). Der erste Patch trägt es immer.
 */
export const telemetryWirePatchesSchema = z.array(
    telemetryPatchSchema.extend({ recorded_at: z.string().optional() }),
);

/**
 * Nachkommastellen von Breiten- und Längengrad auf dem Draht: 6 Stellen sind
 * etwa 0,1 m, feiner als der Streckenverlauf (Precision 5, etwa 1 m) und als
 * die Positionsliste (5 Stellen).
 */
export const WIRE_COORDINATE_DECIMALS = 6;

const WIRE_COORDINATE_FACTOR = 10 ** WIRE_COORDINATE_DECIMALS;

const roundWireCoordinate = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value)
        ? Math.round(value * WIRE_COORDINATE_FACTOR) / WIRE_COORDINATE_FACTOR
        : value;

/**
 * Kürzt die Patches eines Ereignisses für den Draht: Koordinaten auf
 * `WIRE_COORDINATE_DECIMALS`, `recorded_at` nur wo es sich ändert. Die Umkehr
 * ist `expandTelemetryPatches` (bis auf die Rundung verlustfrei).
 */
export function compactTelemetryPatches<T extends object>(patches: readonly T[]): object[] {
    let previous: unknown;

    return patches.map((patch, index) => {
        const { recorded_at: recordedAt, ...rest } = patch as T & {
            recorded_at?: unknown;
        };
        const shortened: Record<string, unknown> = { ...rest };

        if ("latitude" in shortened) {
            shortened.latitude = roundWireCoordinate(shortened.latitude);
        }

        if ("longitude" in shortened) {
            shortened.longitude = roundWireCoordinate(shortened.longitude);
        }

        const repeated = index > 0 && recordedAt === previous;
        previous = recordedAt;

        if (recordedAt === undefined || repeated) {
            return shortened;
        }

        // Feldreihenfolge wie im vollen Patch (id zuerst, dann die Werte).
        return { ...shortened, recorded_at: recordedAt };
    });
}

/** Setzt ausgelassene `recorded_at` aus dem vorigen Patch ein; sonst `null`. */
export function expandTelemetryPatches(
    wire: ReadonlyArray<Omit<TelemetryPatch, "recorded_at"> & { recorded_at?: string }>,
): TelemetryPatch[] | null {
    const patches: TelemetryPatch[] = [];
    let current: string | undefined;

    for (const patch of wire) {
        if (patch.recorded_at !== undefined) {
            current = patch.recorded_at;
        }

        if (current === undefined) {
            return null;
        }

        patches.push({ ...patch, recorded_at: current });
    }

    return patches;
}

/**
 * Ein Rohpunkt aus dem kurzen Live-Fenster.
 * Der dauerhafte Streckenverlauf steckt in `Trip.path`, nicht hier.
 */
export type TelemetryPoint = {
    id: number;
    vehicle_id: number;
    latitude: number;
    longitude: number;
    speed: number;
    recorded_at: string;
};

export type TelemetryHistoryResponse = {
    data: TelemetryPoint[];
};

export const telemetryHistoryQuerySchema = z.object({
    limit: z.preprocess(
        emptyToUndefined,
        z.coerce
            .number({ error: "Limit muss eine Zahl sein." })
            .int("Limit muss eine ganze Zahl sein.")
            .refine(
                (value) =>
                    (TELEMETRY_HISTORY_LIMITS as readonly number[]).includes(
                        value,
                    ),
                {
                    message: `Limit muss ${TELEMETRY_HISTORY_LIMITS.join(", ")} sein.`,
                },
            )
            .default(50),
    ),
});

export type TelemetryHistoryQuery = z.infer<typeof telemetryHistoryQuerySchema>;

export function parseTelemetryHistoryQuery(
    input: unknown,
): TelemetryHistoryQuery {
    return telemetryHistoryQuerySchema.parse(input);
}
