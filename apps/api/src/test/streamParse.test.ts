import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    parseStreamConnected,
    parseTelemetryPatches,
} from "@fleet-live/shared";

describe("parseStreamConnected", () => {
    it("accepts a valid connected payload", () => {
        const connectionId = "550e8400-e29b-41d4-a716-446655440000";

        assert.deepEqual(
            parseStreamConnected({ connection_id: connectionId }),
            { connection_id: connectionId },
        );
    });

    it("rejects invalid connection ids", () => {
        assert.equal(parseStreamConnected({ connection_id: "not-a-uuid" }), null);
        assert.equal(parseStreamConnected({}), null);
        assert.equal(parseStreamConnected(null), null);
    });
});

describe("parseTelemetryPatches", () => {
    it("accepts a valid telemetry batch", () => {
        const patches = [
            {
                id: 1,
                speed: 42,
                latitude: 50.9,
                longitude: 6.9,
                recorded_at: "2026-09-03 12:00:00",
                fuel_level: 80,
                speed_limit_kmh: 50,
                speeding_open: false,
                path_delta: "_p~iF~ps|U_ulL",
                path_reset: true as const,
            },
        ];

        assert.deepEqual(parseTelemetryPatches(patches), patches);
    });

    it("rejects invalid batches", () => {
        assert.equal(parseTelemetryPatches([{ id: "x" }]), null);
        assert.equal(parseTelemetryPatches({ id: 1 }), null);
        assert.equal(parseTelemetryPatches(null), null);
    });
});
