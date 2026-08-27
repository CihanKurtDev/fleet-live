import { z } from "zod";

export const STREAM_FOCUS_MAX_IDS = 150;

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
        .max(500, "Zu viele Fahrzeug-IDs."),
});

export type StreamFocusInput = z.infer<typeof streamFocusSchema>;

export function parseStreamFocus(input: unknown): StreamFocusInput {
    return streamFocusSchema.parse(input);
}
