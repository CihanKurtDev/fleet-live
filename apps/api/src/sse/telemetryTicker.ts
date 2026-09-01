import { logger } from "../logger";
import { TelemetryModel } from "../models/telemetry.model";
import { SpeedingEventModel } from "../models/speedingEvent.model";
import { broadcast, getFocusUnion } from "./hub";
import type { TelemetryPatch } from "@fleet-live/shared";

let timer: ReturnType<typeof setInterval> | undefined;
let intervalMs = 0;

function broadcastPatches(
    patches: Array<TelemetryPatch & { company_id: number }>,
) {
    if (patches.length === 0) {
        return;
    }

    const byCompany = new Map<number, TelemetryPatch[]>();

    for (const patch of patches) {
        const { company_id, ...wire } = patch;
        const group = byCompany.get(company_id);

        if (group) {
            group.push(wire);
            continue;
        }

        byCompany.set(company_id, [wire]);
    }

    for (const [companyId, group] of byCompany) {
        broadcast("telemetry", group, companyId);
    }
}

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
            const notifyCompanies = SpeedingEventModel.applyPatches(patches);
            broadcastPatches(patches);

            for (const companyId of notifyCompanies) {
                broadcast("vehicles-changed", { at: Date.now() }, companyId);
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
