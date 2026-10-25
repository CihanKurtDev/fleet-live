import "./env";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Zip, ZipDeflate } from "fflate";
import { UserModel } from "../models/user.model";
import { loginAs } from "./helpers";

afterEach(() => {
    UserModel.resetForTests();
});

/** A small .xlsx whose one sheet inflates to `megabytes` of zeros. */
function zipBomb(megabytes: number): Buffer {
    const chunks: Uint8Array[] = [];
    const zip = new Zip((error, data) => {
        if (error) {
            throw error;
        }

        chunks.push(data);
    });
    const sheet = new ZipDeflate("xl/worksheets/sheet1.xml", { level: 9 });
    zip.add(sheet);
    const zeros = new Uint8Array(1024 * 1024);

    for (let index = 0; index < megabytes; index += 1) {
        sheet.push(zeros);
    }

    sheet.push(new Uint8Array(0), true);
    zip.end();
    return Buffer.concat(chunks);
}

describe("an Excel import", () => {
    it("refuses a zip bomb before inflating it", async () => {
        const { agent } = await loginAs(1);
        const bomb = zipBomb(250);
        assert.ok(bomb.length < 2 * 1024 * 1024, `bomb is ${bomb.length} bytes`);

        const before = process.memoryUsage().arrayBuffers;
        let peak = before;
        const sampler = setInterval(() => {
            peak = Math.max(peak, process.memoryUsage().arrayBuffers);
        }, 1);
        const response = await agent
            .post("/api/import/preview")
            .send({ xlsx: bomb.toString("base64") });
        clearInterval(sampler);
        peak = Math.max(peak, process.memoryUsage().arrayBuffers);

        assert.equal(response.status, 400);
        assert.match(response.body.error, /zu groß/);
        assert.ok(
            peak - before < 100 * 1024 * 1024,
            `inflated ${Math.round((peak - before) / 1e6)} MB`,
        );
    });
});
