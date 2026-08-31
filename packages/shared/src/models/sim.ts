import { z } from "zod";

export const simPatchSchema = z.object({
    running: z.boolean({ error: "running muss true oder false sein." }),
});

export type SimState = {
    running: boolean;
    /** false, wenn TELEMETRY_TICK_MS=0 — dann gibt es keinen Ticker. */
    available: boolean;
};

export type SimPatch = z.infer<typeof simPatchSchema>;

export function parseSimPatch(input: unknown): SimPatch {
    return simPatchSchema.parse(input);
}
