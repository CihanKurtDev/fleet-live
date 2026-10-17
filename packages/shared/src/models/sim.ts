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

/**
 * A road the simulator drives on, for drawing the network under the
 * vehicles. `path` is an encoded polyline (precision 5, `decodePolyline`).
 */
export type SimRouteLine = {
    id: string;
    from: string;
    to: string;
    path: string;
};

export type SimRouteListResponse = { data: SimRouteLine[] };

export function parseSimPatch(input: unknown): SimPatch {
    return simPatchSchema.parse(input);
}
