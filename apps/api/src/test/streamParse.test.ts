import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    STREAM_FOCUS_MAX_IDS,
    WIRE_COORDINATE_DECIMALS,
    compactTelemetryPatches,
    parseStreamConnected,
    parseStreamFocus,
    parseTelemetryPatches,
} from "@fleet-live/shared";

describe("parseStreamFocus", () => {
    const connection_id = "550e8400-e29b-41d4-a716-446655440000";
    // Hohe IDs sind die Obergrenze der Bodygröße (Server erlaubt 64 kB).
    const idsOf = (count: number) =>
        Array.from({ length: count }, (_, index) => 100_000 + index);

    it("accepts exactly the focus limit and keeps the body under the server limit", () => {
        const input = { connection_id, ids: idsOf(STREAM_FOCUS_MAX_IDS) };

        assert.equal(parseStreamFocus(input).ids.length, STREAM_FOCUS_MAX_IDS);
        assert.ok(JSON.stringify(input).length < 64 * 1024);
    });

    it("rejects more ids than the focus limit", () => {
        assert.throws(() =>
            parseStreamFocus({
                connection_id,
                ids: idsOf(STREAM_FOCUS_MAX_IDS + 1),
            }),
        );
    });
});

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

describe("wire form of telemetry patches", () => {
    const patchAt = (id: number, recordedAt: string, latitude: number, longitude: number) => ({
        id,
        speed: 88,
        speed_limit_kmh: 120,
        latitude,
        longitude,
        recorded_at: recordedAt,
        fuel_level: 57,
        speeding_open: false,
    });

    it("restores what it shortened, up to the coordinate rounding", () => {
        const random = (() => {
            let state = 5;
            return () => (state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296;
        })();
        const originals = Array.from({ length: 300 }, (_, index) =>
            patchAt(
                index + 1,
                index < 150 ? "2026-10-17 12:40:36" : "2026-10-17 12:40:37",
                47 + random() * 8 + 1 / 3,
                6 + random() * 9 + 2 / 3,
            ),
        );

        const wire = JSON.parse(JSON.stringify(compactTelemetryPatches(originals)));
        const restored = parseTelemetryPatches(wire)!;

        assert.equal(restored.length, originals.length);

        restored.forEach((patch, index) => {
            const original = originals[index]!;

            assert.equal(patch.recorded_at, original.recorded_at);
            assert.equal(patch.id, original.id);
            assert.equal(patch.speed, original.speed);
            assert.equal(patch.fuel_level, original.fuel_level);
            assert.equal(patch.speed_limit_kmh, original.speed_limit_kmh);
            assert.equal(patch.speeding_open, original.speeding_open);
            // Halbe Einheit der letzten Stelle ist die größte Abweichung.
            assert.ok(Math.abs(patch.latitude - original.latitude) <= 0.5e-6 + 1e-12);
            assert.ok(Math.abs(patch.longitude - original.longitude) <= 0.5e-6 + 1e-12);
        });
    });

    it("writes recorded_at once per run of equal values and is smaller", () => {
        const originals = [
            patchAt(1, "2026-10-17 12:40:36", 50.123456789, 6.987654321),
            patchAt(2, "2026-10-17 12:40:36", 50.223456789, 6.887654321),
            patchAt(3, "2026-10-17 12:40:37", 50.323456789, 6.787654321),
            patchAt(4, "2026-10-17 12:40:37", 50.423456789, 6.687654321),
        ];
        const wire = compactTelemetryPatches(originals) as Array<Record<string, unknown>>;

        assert.deepEqual(
            wire.map((patch) => patch.recorded_at),
            ["2026-10-17 12:40:36", undefined, "2026-10-17 12:40:37", undefined],
        );
        assert.equal(wire[0]!.latitude, 50.123457);
        assert.ok(JSON.stringify(wire).length < JSON.stringify(originals).length);
    });

    it("keeps the path fields untouched", () => {
        const original = {
            ...patchAt(1, "2026-10-17 12:40:36", 50.1, 6.9),
            path_delta: "_p~iF~ps|U_ulL",
            path_reset: true as const,
        };
        const [restored] = parseTelemetryPatches(
            JSON.parse(JSON.stringify(compactTelemetryPatches([original]))),
        )!;

        assert.equal(restored!.path_delta, "_p~iF~ps|U_ulL");
        assert.equal(restored!.path_reset, true);
    });

    it("still accepts patches that all carry recorded_at (older senders)", () => {
        const full = [
            patchAt(1, "2026-10-17 12:40:36", 50.1, 6.9),
            patchAt(2, "2026-10-17 12:40:36", 50.2, 6.8),
        ];

        assert.deepEqual(parseTelemetryPatches(full), full);
    });

    it("rejects a batch whose first patch has no recorded_at", () => {
        const { recorded_at: _omitted, ...first } = patchAt(1, "x", 50.1, 6.9);

        assert.equal(parseTelemetryPatches([first]), null);
    });

    it("rounds to the documented number of decimals", () => {
        assert.equal(WIRE_COORDINATE_DECIMALS, 6);
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
