import "./env";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    formatAlertEvent,
    speedBand,
    SPEED_HIGH_CRITICAL_KMH,
    SPEED_HIGH_WARNING_KMH,
} from "@fleet-live/shared";

describe("speedBand", () => {
    it("is normal when not driving, even at 0", () => {
        assert.deepEqual(speedBand({ speed: 0, status: "IDLE" }), {
            band: "normal",
            reason: null,
        });
        assert.deepEqual(speedBand({ speed: 0, status: "STOPPED" }), {
            band: "normal",
            reason: null,
        });
        assert.deepEqual(speedBand({ speed: 120, status: "OFFLINE" }), {
            band: "normal",
            reason: null,
        });
    });

    it("is normal when speed is missing", () => {
        assert.deepEqual(speedBand({ speed: null, status: "DRIVING" }), {
            band: "normal",
            reason: null,
        });
    });

    it("is orange over the high threshold until an event is open", () => {
        assert.deepEqual(
            speedBand({ speed: SPEED_HIGH_WARNING_KMH - 1, status: "DRIVING" }),
            { band: "normal", reason: null },
        );
        assert.deepEqual(
            speedBand({ speed: SPEED_HIGH_WARNING_KMH, status: "DRIVING" }),
            { band: "warning", reason: "high" },
        );
        assert.deepEqual(
            speedBand({
                speed: SPEED_HIGH_CRITICAL_KMH,
                status: "DRIVING",
            }),
            { band: "warning", reason: "high" },
        );
    });

    it("is red while a SPEEDING event is open", () => {
        assert.deepEqual(
            speedBand({
                speed: SPEED_HIGH_WARNING_KMH,
                status: "DRIVING",
                speeding_open: true,
            }),
            { band: "critical", reason: "high" },
        );
        assert.deepEqual(
            speedBand({
                speed: 80,
                status: "DRIVING",
                speeding_open: true,
            }),
            { band: "critical", reason: "high" },
        );
    });

    it("does not colour low speed", () => {
        assert.deepEqual(speedBand({ speed: 5, status: "DRIVING" }), {
            band: "normal",
            reason: null,
        });
    });
});

describe("formatAlertEvent", () => {
    it("formats SPEEDING from details", () => {
        assert.equal(
            formatAlertEvent({
                type: "SPEEDING",
                message: "Geschwindigkeit überschritten.",
                details: {
                    limit_kmh: 90,
                    max_speed_kmh: 118,
                    duration_s: 18,
                },
            }),
            "118 km/h bei Limit 90 · 18 s",
        );
    });

    it("falls back to message without details", () => {
        assert.equal(
            formatAlertEvent({
                type: "LOW_FUEL",
                message: "Tankstand ist niedrig.",
                details: null,
            }),
            "Tankstand ist niedrig.",
        );
    });
});
