import "./env";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    formatAlertEvent,
    speedBand,
    SPEED_CRITICAL_OVER_LIMIT_KMH,
} from "@fleet-live/shared";

const CITY_LIMIT = 50;

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

    it("is orange only over the current class limit", () => {
        assert.deepEqual(
            speedBand({
                speed: CITY_LIMIT,
                status: "DRIVING",
                limit_kmh: CITY_LIMIT,
            }),
            { band: "normal", reason: null },
        );
        assert.deepEqual(
            speedBand({
                speed: CITY_LIMIT + 1,
                status: "DRIVING",
                limit_kmh: CITY_LIMIT,
            }),
            { band: "warning", reason: "high" },
        );
        assert.deepEqual(
            speedBand({
                speed: 120,
                status: "DRIVING",
                limit_kmh: 120,
            }),
            { band: "normal", reason: null },
        );
        assert.deepEqual(
            speedBand({ speed: 95, status: "DRIVING" }),
            { band: "normal", reason: null },
        );
    });

    it("is red while a SPEEDING event is open", () => {
        assert.deepEqual(
            speedBand({
                speed: CITY_LIMIT,
                status: "DRIVING",
                speeding_open: true,
                limit_kmh: CITY_LIMIT,
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
        assert.deepEqual(
            speedBand({
                speed: 5,
                status: "DRIVING",
                limit_kmh: CITY_LIMIT,
            }),
            {
                band: "normal",
                reason: null,
            },
        );
    });
});

describe("formatAlertEvent", () => {
    it("formats SPEEDING from details", () => {
        assert.equal(
            formatAlertEvent({
                type: "SPEEDING",
                message: "Geschwindigkeit überschritten.",
                details: {
                    limit_kmh: CITY_LIMIT,
                    max_speed_kmh: CITY_LIMIT + SPEED_CRITICAL_OVER_LIMIT_KMH + 5,
                    duration_s: 18,
                },
            }),
            "75 km/h bei Limit 50 · 18 s",
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
