import {
    type TelemetryPatch,
    type VehicleStatus,
} from "@fleet-live/shared";
import { AlertModel } from "./alert.model";
import { TripEventModel } from "./tripEvent.model";
import {
    speedingDurationS,
    speedingSeverity,
    stepSpeeding,
    type SpeedingTracker,
} from "../lib/speeding";
import { sqliteFromMs } from "../lib/sqlTime";

const trackers = new Map<number, SpeedingTracker>();

/** Ohne Tick endet ein offenes Tempo-Ereignis nach dieser Zeit von selbst. */
export const SPEEDING_STALE_MS = 60_000;
const lastTickMs = new Map<number, number>();
const startedAtMs = Date.now();

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
        // A warning that carries earlier overshoots of its trip starts this
        // one now; counting from its creation would count the pauses too.
        startedAtMs:
            open.details?.carried_duration_s !== undefined
                ? Date.now()
                : parseCreatedAtMs(open.created_at),
        maxSpeed: open.maxSpeed,
        writtenMaxSpeed: open.details?.max_speed_kmh,
        writtenDurationS: open.details?.duration_s,
        writtenLimitKmh: open.details?.limit_kmh,
    };
}

function detailsFor(
    state: SpeedingTracker,
    nowMs: number,
    limitKmh: number,
) {
    return {
        limit_kmh: limitKmh,
        max_speed_kmh: state.maxSpeed,
        duration_s: speedingDurationS(state.startedAtMs, nowMs),
    };
}

function applyAction(
    vehicleId: number,
    previous: SpeedingTracker | undefined,
    step: ReturnType<typeof stepSpeeding>,
    nowMs: number,
    limitKmh: number,
): { speedingOpen: boolean; notify: boolean } {
    if (step.action === "open" && step.state) {
        const details = detailsFor(step.state, nowMs, limitKmh);
        const alertId = AlertModel.openSpeeding({
            vehicleId,
            createdAt: sqliteFromMs(step.state.startedAtMs),
            severity: speedingSeverity(step.state.maxSpeed, limitKmh),
            details,
        });
        trackers.set(vehicleId, {
            ...step.state,
            alertId,
            writtenDurationS: details.duration_s,
            writtenMaxSpeed: details.max_speed_kmh,
            writtenLimitKmh: details.limit_kmh,
        });
        TripEventModel.trackSpeeding(vehicleId, {
            alertId,
            startedAt: sqliteFromMs(step.state.startedAtMs),
            fromM: step.state.fromM,
            maxSpeedKmh: step.state.maxSpeed,
            limitKmh,
        });
        return { speedingOpen: true, notify: true };
    }

    if (step.action === "update" && step.state) {
        const alertId = step.state.alertId ?? previous?.alertId;

        if (alertId !== undefined) {
            const details = detailsFor(step.state, nowMs, limitKmh);
            AlertModel.updateSpeeding(
                alertId,
                speedingSeverity(step.state.maxSpeed, limitKmh),
                details,
            );
            trackers.set(vehicleId, {
                ...step.state,
                alertId,
                writtenDurationS: details.duration_s,
                writtenMaxSpeed: details.max_speed_kmh,
                writtenLimitKmh: details.limit_kmh,
            });
        } else {
            trackers.set(vehicleId, step.state);
        }

        // Carries on into a new trip after a turnaround, and after a restart.
        TripEventModel.trackSpeeding(vehicleId, {
            alertId,
            startedAt: sqliteFromMs(nowMs),
            maxSpeedKmh: step.state.maxSpeed,
            limitKmh,
        });

        return { speedingOpen: true, notify: false };
    }

    if (step.action === "end") {
        const alertId = previous?.alertId;

        if (alertId !== undefined) {
            AlertModel.endSpeeding(alertId, sqliteFromMs(nowMs));
        }

        TripEventModel.end([vehicleId], "SPEEDING", sqliteFromMs(nowMs));
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
    limitKmh: number | null | undefined,
): { speedingOpen: boolean; notify: boolean } {
    let state = trackers.get(vehicleId);

    if (!state) {
        state = hydrate(vehicleId);
        if (state) {
            trackers.set(vehicleId, state);
        }
    }

    const previous = state;
    const step = stepSpeeding(state, {
        speed,
        status,
        nowMs,
        limit_kmh: limitKmh,
    });

    // Where the run begins on the trip: the first tick over the limit, not
    // the one 8 s later that opens the warning.
    if (!previous && step.state?.phase === "candidate") {
        step.state.fromM = TripEventModel.openDistance(vehicleId) ?? undefined;
    }
    const detailsLimit =
        typeof limitKmh === "number"
            ? limitKmh
            : (previous?.writtenLimitKmh ?? 0);
    return applyAction(vehicleId, previous, step, nowMs, detailsLimit);
}

export class SpeedingEventModel {
    static applyPatches(
        patches: Array<TelemetryPatch & { company_id: number }>,
        nowMs = Date.now(),
    ): number[] {
        const notify = new Set<number>();

        for (const patch of patches) {
            lastTickMs.set(patch.id, nowMs);
            const result = tickOne(
                patch.id,
                patch.speed,
                "DRIVING",
                nowMs,
                patch.speed_limit_kmh,
            );
            patch.speeding_open = result.speedingOpen;

            if (result.notify) {
                notify.add(patch.company_id);
            }
        }

        return [...notify];
    }

    /**
     * Beendet offene Ereignisse, deren Fahrzeug seit `SPEEDING_STALE_MS`
     * keinen Tick bekommen hat (nicht im Fokus, Prozess neu gestartet).
     * Sonst blieben sie für immer „läuft“. Gibt die betroffenen Firmen zurück.
     */
    static endStale(nowMs = Date.now()): number[] {
        const notify = new Set<number>();

        for (const row of AlertModel.listOpenSpeeding()) {
            const seen = lastTickMs.get(row.vehicle_id) ?? startedAtMs;

            if (nowMs - seen < SPEEDING_STALE_MS) {
                continue;
            }

            AlertModel.endSpeeding(row.id, sqliteFromMs(seen));
            TripEventModel.end([row.vehicle_id], "SPEEDING", sqliteFromMs(seen));
            trackers.delete(row.vehicle_id);
            notify.add(row.company_id);
        }

        return [...notify];
    }

    static endForVehicle(vehicleId: number, nowMs = Date.now()): void {
        tickOne(vehicleId, 0, "IDLE", nowMs, null);
    }

    static resetForTests() {
        trackers.clear();
        lastTickMs.clear();
    }
}
