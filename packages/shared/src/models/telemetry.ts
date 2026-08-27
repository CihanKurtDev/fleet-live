import { z } from "zod";

export const TELEMETRY_HISTORY_LIMITS = [10, 25, 50, 100] as const;

export type TelemetryHistoryLimit = (typeof TELEMETRY_HISTORY_LIMITS)[number];

/** Live-Patch eines Fahrzeugs aus dem Telemetrie-Stream. */
export type TelemetryPatch = {
    id: number;
    speed: number;
    latitude: number;
    longitude: number;
    recorded_at: string;
};

/** Ein persistierter Telemetriepunkt (History-API). */
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

const emptyToUndefined = (value: unknown): unknown => {
    if (value === "" || value === null || value === undefined) {
        return undefined;
    }

    if (Array.isArray(value)) {
        return emptyToUndefined(value[0]);
    }

    return value;
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
                { message: "Limit muss 10, 25, 50 oder 100 sein." },
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
