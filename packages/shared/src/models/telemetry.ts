import { z } from "zod";
import { emptyToUndefined } from "./queryPreprocess";

export const TELEMETRY_HISTORY_LIMITS = [10, 25, 50, 100] as const;

export type TelemetryHistoryLimit = (typeof TELEMETRY_HISTORY_LIMITS)[number];

/** Live-Patch eines Fahrzeugs aus dem Telemetrie-Stream. */
export type TelemetryPatch = {
    id: number;
    speed: number;
    latitude: number;
    longitude: number;
    recorded_at: string;
    /** Gemessener Tankstand, solange das Fahrzeug unterwegs ist. */
    fuel_level: number;
    /** Offenes SPEEDING-Ereignis nach dem Tick, für die Live-Farbe. */
    speeding_open?: boolean;
    /**
     * Encoded-Polyline-Suffix der dieses Tick gefahrenen Straßenpunkte.
     * Relativ zum letzten Punkt der offenen Fahrt — an `Trip.path` anhängen,
     * außer `path_reset` ist gesetzt.
     */
    path_delta?: string;
    /**
     * Der Suffix gehört zu einer neuen Fahrt. Den bisherigen Verlauf
     * verwerfen, nicht anhängen.
     */
    path_reset?: true;
};

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
