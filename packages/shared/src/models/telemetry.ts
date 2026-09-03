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
