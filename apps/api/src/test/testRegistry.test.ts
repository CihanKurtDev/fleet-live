import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const API_DIR = path.resolve(__dirname, "../..");

/** The files `npm test` runs: the paths in the `test` script. */
const registered = () => {
    const script = JSON.parse(
        readFileSync(path.join(API_DIR, "package.json"), "utf8"),
    ).scripts.test as string;

    return script.split(/\s+/).filter((part) => part.startsWith("src/test/"));
};

describe("the test script", () => {
    it("names only files that exist (a missing space glues two paths)", () => {
        for (const file of registered()) {
            assert.ok(existsSync(path.join(API_DIR, file)), `${file} does not exist`);
        }
    });

    it("runs every test file in src/test", () => {
        const listed = new Set(registered());
        const missing = readdirSync(path.join(API_DIR, "src/test"))
            .filter((name) => name.endsWith(".test.ts"))
            .map((name) => `src/test/${name}`)
            .filter((file) => !listed.has(file));

        assert.deepEqual(missing, []);
    });
});
