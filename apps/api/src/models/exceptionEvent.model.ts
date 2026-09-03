import {
    OFFLINE_AFTER_MS,
    type TelemetryPatch,
    type VehicleStatus,
} from "@fleet-live/shared";
import { isCompanySimRunning } from "../lib/simControl";
import { sqliteFromMs } from "../lib/sqlTime";
import { AlertModel } from "./alert.model";

const OFFLINE_MESSAGE = "Fahrzeug sendet kein Signal.";

type LastReport = {
    companyId: number;
    atMs: number;
};

const lastReport = new Map<number, LastReport>();

function applyOfflineStatus(
    vehicleId: number,
    status: VehicleStatus,
    nowMs: number,
): boolean {
    if (status !== "OFFLINE") {
        AlertModel.endOpenType(vehicleId, "OFFLINE", sqliteFromMs(nowMs));
        return false;
    }

    return AlertModel.ensureOpen({
        vehicleId,
        type: "OFFLINE",
        createdAt: sqliteFromMs(nowMs),
        severity: "HIGH",
        message: OFFLINE_MESSAGE,
        details: null,
    }).opened;
}

/**
 * Live OFFLINE aus dem Ticker bzw. Fahrzeug-Write.
 * SPEEDING bleibt in `SpeedingEventModel` (8 s-Maschine).
 * Tankstand ist kein Live-Ticker — nur `vehicles.fuel_level` in der UI.
 */
export class ExceptionEventModel {
    /** Fahrzeuge mit frischem Tick: OFFLINE endet (Signal ist da). */
    static applyPatches(
        patches: Array<TelemetryPatch & { company_id: number }>,
        nowMs = Date.now(),
    ): number[] {
        const notify = new Set<number>();

        for (const patch of patches) {
            lastReport.set(patch.id, {
                companyId: patch.company_id,
                atMs: nowMs,
            });
            AlertModel.endOpenType(patch.id, "OFFLINE", sqliteFromMs(nowMs));
        }

        return [...notify];
    }

    /**
     * Pausierte Firma: Fahrzeuge, die zuletzt simuliert wurden und seit
     * `OFFLINE_AFTER_MS` keinen Tick mehr bekommen. Läuft die Sim, sind
     * Lücken Focus/Batch — kein Funkloch.
     */
    static applySilence(nowMs = Date.now()): number[] {
        const notify = new Set<number>();

        for (const [vehicleId, report] of lastReport) {
            if (isCompanySimRunning(report.companyId)) {
                continue;
            }

            if (nowMs - report.atMs < OFFLINE_AFTER_MS) {
                continue;
            }

            const opened = AlertModel.ensureOpen({
                vehicleId,
                type: "OFFLINE",
                createdAt: sqliteFromMs(report.atMs + OFFLINE_AFTER_MS),
                severity: "HIGH",
                message: OFFLINE_MESSAGE,
                details: null,
            }).opened;

            if (opened) {
                notify.add(report.companyId);
            }
        }

        return [...notify];
    }

    /** Create/Update: Status `OFFLINE` öffnet bzw. beendet Funk-Warnung. */
    static syncVehicle(input: {
        id: number;
        status: VehicleStatus;
    }, nowMs = Date.now()): void {
        applyOfflineStatus(input.id, input.status, nowMs);
    }

    static resetForTests() {
        lastReport.clear();
    }
}
