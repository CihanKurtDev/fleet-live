import {
    SPEED_HIGH_WARNING_KMH,
    type TelemetryPatch,
    type VehicleStatus,
} from "@fleet-live/shared";
import { AlertModel } from "./alert.model";
import {
    speedingDurationS,
    speedingSeverity,
    stepSpeeding,
    type SpeedingTracker,
} from "../lib/speeding";
import { sqliteFromMs } from "../lib/sqlTime";

const trackers = new Map<number, SpeedingTracker>();

function parseCreatedAtMs(createdAt: string): number {
    const parsed = Date.parse(`${createdAt}Z`);
    return Number.isNaN(parsed) ? Date.now() : parsed;
}

function hydrate(vehicleId: number): SpeedingTracker | undefined {
    const open = AlertModel.findOpenSpeeding(vehicleId);

    if (!open) {
        return undefined;
    }

    return {
        phase: "open",
        alertId: open.id,
        startedAtMs: parseCreatedAtMs(open.created_at),
        maxSpeed: open.maxSpeed,
        writtenMaxSpeed: open.details?.max_speed_kmh,
        writtenDurationS: open.details?.duration_s,
    };
}

function detailsFor(state: SpeedingTracker, nowMs: number) {
    return {
        limit_kmh: SPEED_HIGH_WARNING_KMH,
        max_speed_kmh: state.maxSpeed,
        duration_s: speedingDurationS(state.startedAtMs, nowMs),
    };
}

function applyAction(
    vehicleId: number,
    previous: SpeedingTracker | undefined,
    step: ReturnType<typeof stepSpeeding>,
    nowMs: number,
): { speedingOpen: boolean; notify: boolean } {
    if (step.action === "open" && step.state) {
        const details = detailsFor(step.state, nowMs);
        const alertId = AlertModel.openSpeeding({
            vehicleId,
            createdAt: sqliteFromMs(step.state.startedAtMs),
            severity: speedingSeverity(step.state.maxSpeed),
            details,
        });
        trackers.set(vehicleId, {
            ...step.state,
            alertId,
            writtenDurationS: details.duration_s,
            writtenMaxSpeed: details.max_speed_kmh,
        });
        return { speedingOpen: true, notify: true };
    }

    if (step.action === "update" && step.state) {
        const alertId = step.state.alertId ?? previous?.alertId;

        if (alertId !== undefined) {
            const details = detailsFor(step.state, nowMs);
            AlertModel.updateSpeeding(
                alertId,
                speedingSeverity(step.state.maxSpeed),
                details,
            );
            trackers.set(vehicleId, {
                ...step.state,
                alertId,
                writtenDurationS: details.duration_s,
                writtenMaxSpeed: details.max_speed_kmh,
            });
        } else {
            trackers.set(vehicleId, step.state);
        }

        return { speedingOpen: true, notify: false };
    }

    if (step.action === "end") {
        const alertId = previous?.alertId;

        if (alertId !== undefined) {
            AlertModel.endSpeeding(alertId, sqliteFromMs(nowMs));
        }

        trackers.delete(vehicleId);
        return { speedingOpen: false, notify: false };
    }

    if (step.state) {
        trackers.set(vehicleId, step.state);
    } else {
        trackers.delete(vehicleId);
    }

    return {
        speedingOpen: step.state?.phase === "open",
        notify: false,
    };
}

function tickOne(
    vehicleId: number,
    speed: number | null,
    status: VehicleStatus,
    nowMs: number,
): { speedingOpen: boolean; notify: boolean } {
    let state = trackers.get(vehicleId);

    if (!state) {
        state = hydrate(vehicleId);
        if (state) {
            trackers.set(vehicleId, state);
        }
    }

    const previous = state;
    const step = stepSpeeding(state, { speed, status, nowMs });
    return applyAction(vehicleId, previous, step, nowMs);
}

export class SpeedingEventModel {
    static applyPatches(
        patches: Array<TelemetryPatch & { company_id: number }>,
        nowMs = Date.now(),
    ): number[] {
        const notify = new Set<number>();

        for (const patch of patches) {
            const result = tickOne(patch.id, patch.speed, "DRIVING", nowMs);
            patch.speeding_open = result.speedingOpen;

            if (result.notify) {
                notify.add(patch.company_id);
            }
        }

        return [...notify];
    }

    static endForVehicle(vehicleId: number, nowMs = Date.now()): void {
        tickOne(vehicleId, 0, "IDLE", nowMs);
    }

    static resetForTests() {
        trackers.clear();
    }
}
