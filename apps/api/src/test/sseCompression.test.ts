import "./env";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
import { PassThrough, Writable } from "node:stream";
import zlib from "node:zlib";
import type { Response } from "express";

import { app } from "../app";
import { UserModel } from "../models/user.model";
import { closeAllSseClients } from "../sse/hub";
import { openSseWriter, pickEncoding } from "../sse/compression";
import { loginAs } from "./helpers";

/** Eine Antwort, die nur sammelt, was auf den Draht geht. */
function fakeResponse(highWaterMark = 16 * 1024) {
    const headers = new Map<string, string>();
    const wire = new PassThrough({ highWaterMark });
    const res = Object.assign(wire, {
        setHeader(name: string, value: string) {
            headers.set(name.toLowerCase(), value);
        },
    });

    return { res: res as unknown as Response, wire, headers };
}

const event = (id: number, body: string) =>
    `id: ${id}\nevent: telemetry\ndata: ${body}\n\n`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("pickEncoding", () => {
    it("prefers brotli, then gzip, else nothing", () => {
        assert.equal(pickEncoding("gzip, deflate, br, zstd"), "br");
        assert.equal(pickEncoding("gzip, deflate"), "gzip");
        assert.equal(pickEncoding("deflate"), "identity");
        assert.equal(pickEncoding(""), "identity");
        assert.equal(pickEncoding(undefined), "identity");
    });

    it("respects q=0 as a refusal and ignores case and spaces", () => {
        assert.equal(pickEncoding("br;q=0, gzip"), "gzip");
        assert.equal(pickEncoding("gzip;q=0, br;q=0"), "identity");
        assert.equal(pickEncoding(" GZIP ; q=0.5"), "gzip");
    });
});

describe("GET /api/stream over real HTTP", () => {
    afterEach(() => {
        closeAllSseClients();
        UserModel.resetForTests();
    });

    for (const [accept, expected] of [
        ["br, gzip", "br"],
        ["gzip", "gzip"],
        [undefined, undefined],
    ] as const) {
        it(`answers "${accept ?? "no accept-encoding"}" with ${expected ?? "plain text"} and a readable first chunk`, async () => {
            const { cookie } = await loginAs(1);
            const server = app.listen(0);
            await new Promise<void>((resolve) => server.once("listening", resolve));

            try {
                const { port } = server.address() as AddressInfo;
                const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
                    http
                        .get(
                            {
                                port,
                                path: "/api/stream",
                                headers: {
                                    cookie,
                                    ...(accept ? { "accept-encoding": accept } : {}),
                                },
                            },
                            resolve,
                        )
                        .on("error", reject);
                });

                assert.equal(response.headers["content-encoding"], expected);
                assert.match(String(response.headers["content-type"]), /text\/event-stream/);

                const source =
                    expected === "br"
                        ? response.pipe(zlib.createBrotliDecompress())
                        : expected === "gzip"
                          ? response.pipe(zlib.createGunzip())
                          : response;
                const first = await new Promise<string>((resolve) =>
                    source.once("data", (chunk: Buffer) => resolve(chunk.toString())),
                );

                assert.match(first, /^retry: 3000\n\nevent: connected\ndata: \{"connection_id":"/);

                response.destroy();
            } finally {
                closeAllSseClients();
                await new Promise<void>((resolve) => {
                    server.close(() => resolve());
                    server.closeAllConnections();
                });
            }
        });
    }
});

describe("SSE compression", () => {
    it("leaves the response alone when the browser takes nothing", () => {
        const { res, headers } = fakeResponse();

        assert.equal(openSseWriter(res, undefined), res);
        assert.equal(headers.get("content-encoding"), undefined);
        assert.equal(headers.get("vary"), "Accept-Encoding");
    });

    for (const [encoding, decoder] of [
        ["gzip", () => zlib.createGunzip()],
        ["br", () => zlib.createBrotliDecompress()],
    ] as const) {
        it(`delivers each ${encoding} event at once, without waiting for the end`, async () => {
            const { res, wire, headers } = fakeResponse();
            const writer = openSseWriter(res, encoding);
            const decoded: string[] = [];
            const decode = decoder();

            assert.equal(headers.get("content-encoding"), encoding);

            decode.on("data", (chunk: Buffer) => decoded.push(chunk.toString()));
            wire.pipe(decode);

            writer.write(event(1, '{"a":1}'));
            await sleep(60);
            assert.equal(decoded.join(""), event(1, '{"a":1}'));

            writer.write(event(2, '{"b":2}'));
            await sleep(60);
            assert.equal(
                decoded.join(""),
                event(1, '{"a":1}') + event(2, '{"b":2}'),
            );

            writer.end();
        });
    }

    it("makes a repeated tick much smaller than its plain size", async () => {
        const { res, wire } = fakeResponse(1024 * 1024);
        const writer = openSseWriter(res, "br");
        const patches = Array.from({ length: 500 }, (_, index) => ({
            id: index + 1,
            speed: 88,
            speed_limit_kmh: 120,
            latitude: 50.1 + index / 1000,
            longitude: 6.9 + index / 1000,
            fuel_level: 57,
            speeding_open: false,
        }));
        const plain = event(1, JSON.stringify(patches));
        let sent = 0;

        wire.on("data", (chunk: Buffer) => {
            sent += chunk.length;
        });

        for (let tick = 0; tick < 4; tick += 1) {
            writer.write(event(tick + 1, JSON.stringify(patches)));
        }

        await sleep(100);
        writer.end();

        assert.ok(sent < plain.length * 4 * 0.2, `${sent} of ${plain.length * 4}`);
    });

    it("reports a full socket and drains again once the viewer reads", async () => {
        // Kleiner Puffer, niemand liest: der Kompressor muss „voll“ melden.
        const { res, wire } = fakeResponse(1024);
        const writer = openSseWriter(res, "gzip");
        // Schlecht komprimierbare Daten, damit der Rückstau sicher entsteht.
        const noise = () =>
            Array.from({ length: 4000 }, () => Math.random().toString(36).slice(2)).join("");

        for (let index = 0; index < 40 && !writer.writableNeedDrain; index += 1) {
            writer.write(event(index, noise()));
        }

        assert.equal(writer.writableNeedDrain, true);

        let drained = false;
        writer.once("drain", () => {
            drained = true;
        });

        wire.pipe(new Writable({ write: (_chunk, _enc, done) => done() }));
        await sleep(100);

        assert.equal(drained, true);
        assert.equal(writer.writableNeedDrain, false);
    });
});
