import { logger } from "../logger";
import { TelemetryModel } from "../models/telemetry.model";
import { broadcast, getFocusUnion } from "./hub";

let timer: ReturnType<typeof setInterval> | undefined;
let intervalMs = 0;

export function isTelemetryTickerRunning(): boolean {
    return timer !== undefined;
}

export function startTelemetryTicker(ms: number) {
    intervalMs = ms;

    if (timer || ms <= 0) {
        return;
    }

    timer = setInterval(() => {
        try {
            const focusIds = getFocusUnion();

            if (focusIds.length === 0) {
                return;
            }

            const patches = TelemetryModel.tickDrivingVehicles(focusIds);

            if (patches.length > 0) {
                broadcast("telemetry", patches);
            }
        } catch (error) {
            logger.error({ err: error }, "telemetry tick failed");
        }
    }, ms);

    timer.unref?.();
    logger.info({ intervalMs: ms }, "telemetry ticker started");
}

export function stopTelemetryTicker() {
    if (!timer) {
        return;
    }

    clearInterval(timer);
    timer = undefined;
    logger.info("telemetry ticker stopped");
}

export function setTelemetryTickerRunning(running: boolean): boolean {
    if (running) {
        startTelemetryTicker(intervalMs);
    } else {
        stopTelemetryTicker();
    }

    return isTelemetryTickerRunning();
}
