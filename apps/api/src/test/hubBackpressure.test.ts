import "./env";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Response } from "express";
import { parseTelemetryPatches } from "@fleet-live/shared";

import {
    broadcast,
    closeAllSseClients,
    setConnectionFocus,
    subscribe,
    unsubscribe,
} from "../sse/hub";

/** Ein Socket, der sich voll melden und wieder leeren lässt. */
function fakeSocket() {
    const writes: string[] = [];
    let drain: (() => void) | undefined;
    const res = {
        writableNeedDrain: false,
        write(chunk: string) {
            writes.push(chunk);
            return true;
        },
        once(event: string, listener: () => void) {
            if (event === "drain") {
                drain = listener;
            }
        },
        end() {},
    };

    return {
        res,
        asResponse: res as unknown as Response,
        writes,
        /** Der Socket ist wieder frei. */
        empty() {
            res.writableNeedDrain = false;
            const listener = drain;
            drain = undefined;
            listener?.();
        },
    };
}

type Wire = { id: number; event: string; data: Array<Record<string, unknown>> };

const parse = (chunk: string): Wire => {
    const id = Number(/^id: (\d+)$/m.exec(chunk)?.[1]);
    const event = /^event: (.+)$/m.exec(chunk)?.[1] ?? "";
    const data = JSON.parse(/^data: (.*)$/m.exec(chunk)?.[1] ?? "null");

    return { id, event, data };
};

const patch = (id: number, latitude: number, extra: Record<string, unknown> = {}) => ({
    id,
    speed: 40,
    latitude,
    longitude: 6.9,
    recorded_at: "2026-01-01 00:00:00",
    fuel_level: 80,
    ...extra,
});

function connect(ids: number[]) {
    const socket = fakeSocket();
    const connectionId = subscribe(socket.asResponse, 1);

    setConnectionFocus(connectionId, ids, 1);
    return socket;
}

afterEach(() => {
    closeAllSseClients();
});

describe("SSE hub with a slow viewer", () => {
    it("writes at once while the socket accepts data", () => {
        const socket = connect([1]);

        broadcast("telemetry", [patch(1, 50.1)], 1);

        assert.equal(socket.writes.length, 1);
        assert.equal(parse(socket.writes[0]!).data[0]!.latitude, 50.1);
    });

    it("sends shortened telemetry that the browser parser restores", () => {
        const socket = connect([1, 2]);

        broadcast(
            "telemetry",
            [patch(1, 50.123456789), patch(2, 50.987654321)],
            1,
        );

        const raw = JSON.parse(/^data: (.*)$/m.exec(socket.writes[0]!)![1]!);

        assert.equal(raw[0].recorded_at, "2026-01-01 00:00:00");
        assert.equal(raw[1].recorded_at, undefined);
        assert.equal(raw[0].latitude, 50.123457);

        const restored = parseTelemetryPatches(raw)!;

        assert.equal(restored[1]!.recorded_at, "2026-01-01 00:00:00");
        assert.equal(restored[1]!.latitude, 50.987654);
    });

    it("holds one merged patch per vehicle while the socket is full", () => {
        const socket = connect([1, 2]);
        socket.res.writableNeedDrain = true;

        for (let tick = 0; tick < 500; tick += 1) {
            broadcast(
                "telemetry",
                [
                    patch(1, 50 + tick / 1000, { path_delta: "ab" }),
                    patch(2, 51 + tick / 1000),
                ],
                1,
            );
        }

        assert.equal(socket.writes.length, 0);

        socket.empty();

        assert.equal(socket.writes.length, 1);

        const sent = parse(socket.writes[0]!);
        const first = sent.data.find((item) => item.id === 1)!;
        const second = sent.data.find((item) => item.id === 2)!;

        assert.equal(sent.event, "telemetry");
        assert.equal(sent.data.length, 2);
        assert.equal(first.latitude, 50.499);
        assert.equal(first.path_delta, "ab".repeat(500));
        assert.equal(first.path_reset, undefined);
        assert.equal(second.latitude, 51.499);
        assert.equal(second.path_delta, undefined);
    });

    it("drops what waited before a new trip begins", () => {
        const socket = connect([1]);
        socket.res.writableNeedDrain = true;

        broadcast("telemetry", [patch(1, 50.1, { path_delta: "old" })], 1);
        broadcast(
            "telemetry",
            [patch(1, 50.2, { path_delta: "new", path_reset: true })],
            1,
        );
        broadcast("telemetry", [patch(1, 50.3, { path_delta: "more" })], 1);
        socket.empty();

        const merged = parse(socket.writes[0]!).data[0]!;

        assert.equal(merged.path_delta, "newmore");
        assert.equal(merged.path_reset, true);
        assert.equal(merged.latitude, 50.3);
    });

    it("keeps a path that arrives with no movement in between", () => {
        const socket = connect([1]);
        socket.res.writableNeedDrain = true;

        broadcast("telemetry", [patch(1, 50.1, { path_delta: "ab" })], 1);
        broadcast("telemetry", [patch(1, 50.1)], 1);
        socket.empty();

        assert.equal(parse(socket.writes[0]!).data[0]!.path_delta, "ab");
    });

    it("sends small events at once even when the socket is full", () => {
        const socket = connect([1]);
        socket.res.writableNeedDrain = true;

        broadcast("vehicles-changed", { at: 1 }, 1);

        assert.equal(socket.writes.length, 1);
        assert.equal(/^event: (.+)$/m.exec(socket.writes[0]!)?.[1], "vehicles-changed");
    });

    it("goes on with direct writes after the merged tick", () => {
        const socket = connect([1]);
        socket.res.writableNeedDrain = true;

        broadcast("telemetry", [patch(1, 50.1)], 1);
        socket.empty();
        broadcast("telemetry", [patch(1, 50.2)], 1);

        assert.equal(socket.writes.length, 2);
        assert.equal(parse(socket.writes[1]!).data[0]!.latitude, 50.2);
    });

    it("does not touch the other viewers", () => {
        const slow = connect([1]);
        const fast = connect([1]);
        slow.res.writableNeedDrain = true;

        broadcast("telemetry", [patch(1, 50.1)], 1);
        broadcast("telemetry", [patch(1, 50.2)], 1);

        assert.equal(slow.writes.length, 0);
        assert.equal(fast.writes.length, 2);

        unsubscribe(slow.asResponse);
    });
});
