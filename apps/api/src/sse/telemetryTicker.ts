import { logger } from "../logger";
import { TelemetryModel } from "../models/telemetry.model";
import { broadcast, getFocusUnion } from "./hub";

let timer: ReturnType<typeof setInterval> | undefined;

export function startTelemetryTicker(intervalMs: number) {
    if (timer || intervalMs <= 0) {
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
    }, intervalMs);

    timer.unref?.();
    logger.info({ intervalMs }, "telemetry ticker started");
}

export function stopTelemetryTicker() {
    if (!timer) {
        return;
    }

    clearInterval(timer);
    timer = undefined;
}
