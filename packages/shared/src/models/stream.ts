import { z } from "zod";

import {
    expandTelemetryPatches,
    telemetryWirePatchesSchema,
    type TelemetryPatch,
} from "./telemetry";

/**
 * Ein Tick kostet den Server rund 0,1 ms pro Fahrzeug (gemessen auf der Dev-DB
 * im echten Server: 2.811 Fahrzeuge in ~290 ms bei 400 ms Takt, 5 Minuten lang
 * stabil, jeder weitere Zuschauer ~1,5 ms). Bei 3.000 bleiben etwa 25 % Puffer;
 * im Browser wuchs die Bildzeit bis ~3.200 Patches pro Takt nicht. Läuft ein Tick
 * länger als sein Takt, werden die Fahrzeuge langsamer.
 */
export const STREAM_FOCUS_MAX_IDS = 3000;

/** Typprüfung; die Connection cappt danach auf STREAM_FOCUS_MAX_IDS. */

export const streamFocusSchema = z.object({
    connection_id: z
        .string({ error: "Verbindung fehlt." })
        .uuid("Ungültige Verbindungs-ID."),
    ids: z
        .array(
            z
                .number({ error: "Fahrzeug-IDs müssen Zahlen sein." })
                .int("Fahrzeug-IDs müssen ganze Zahlen sein.")
                .positive("Fahrzeug-IDs müssen größer als 0 sein."),
            { error: "ids muss ein Array von Zahlen sein." },
        )
        .max(STREAM_FOCUS_MAX_IDS, "Zu viele Fahrzeug-IDs."),
});

export type StreamFocusInput = z.infer<typeof streamFocusSchema>;

export function parseStreamFocus(input: unknown): StreamFocusInput {
    return streamFocusSchema.parse(input);
}

/** SSE `connected` — liefert die Verbindungs-ID für `POST /api/stream/focus`. */
export const streamConnectedSchema = z.object({
    connection_id: z
        .string({ error: "Verbindung fehlt." })
        .uuid("Ungültige Verbindungs-ID."),
});

export type StreamConnected = z.infer<typeof streamConnectedSchema>;

export function parseStreamConnected(input: unknown): StreamConnected | null {
    const parsed = streamConnectedSchema.safeParse(input);

    return parsed.success ? parsed.data : null;
}

/** SSE `telemetry` — Batch live Patches; ungültige Payloads → `null`. */
export function parseTelemetryPatches(input: unknown): TelemetryPatch[] | null {
    const parsed = telemetryWirePatchesSchema.safeParse(input);

    return parsed.success ? expandTelemetryPatches(parsed.data) : null;
}
