import { logger } from "../logger";
import { TelemetryModel } from "../models/telemetry.model";
import { getFocusIds } from "./focus";
import { broadcast } from "./hub";

let timer: ReturnType<typeof setInterval> | undefined;

export function startTelemetryTicker(intervalMs: number) {
    if (timer || intervalMs <= 0) {
        return;
    }

    timer = setInterval(() => {
        try {
            const patches = TelemetryModel.tickDrivingVehicles(getFocusIds());

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
