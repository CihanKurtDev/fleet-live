import { afterEach, describe, expect, it, vi } from "vitest";

import { retryTransient } from "./retryTransient";

describe("retryTransient", () => {
    afterEach(() => vi.useRealTimers());

    it("retries transient failures and stops after three attempts", async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const run = vi.fn<() => Promise<string>>().mockRejectedValue(
            new TypeError("offline"),
        );

        const result = retryTransient(run, controller.signal);
        const expectation = expect(result).rejects.toThrow("offline");
        await vi.runAllTimersAsync();

        await expectation;
        expect(run).toHaveBeenCalledTimes(3);
    });

    it("returns as soon as a retry succeeds", async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const run = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(new TypeError("offline"))
            .mockResolvedValue("ok");

        const result = retryTransient(run, controller.signal);
        await vi.runAllTimersAsync();

        await expect(result).resolves.toBe("ok");
        expect(run).toHaveBeenCalledTimes(2);
    });
});
