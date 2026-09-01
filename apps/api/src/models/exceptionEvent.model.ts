import {
    formatAlertEvent,
    isLowFuelLevel,
    lowFuelSeverity,
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

function lowFuelMessage(fuelLevel: number): string {
    return formatAlertEvent({
        type: "LOW_FUEL",
        message: "Tankstand ist niedrig.",
        details: { fuel_level: fuelLevel },
    });
}

function applyLowFuel(
    vehicleId: number,
    fuelLevel: number,
    nowMs: number,
): boolean {
    if (!isLowFuelLevel(fuelLevel)) {
        AlertModel.endOpenType(vehicleId, "LOW_FUEL", sqliteFromMs(nowMs));
        return false;
    }

    return AlertModel.ensureOpen({
        vehicleId,
        type: "LOW_FUEL",
        createdAt: sqliteFromMs(nowMs),
        severity: lowFuelSeverity(fuelLevel),
        message: lowFuelMessage(fuelLevel),
        details: { fuel_level: fuelLevel },
    }).opened;
}

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
 * Live LOW_FUEL und OFFLINE aus dem Ticker bzw. Fahrzeug-Write.
 * SPEEDING bleibt in `SpeedingEventModel` (8 s-Maschine).
 */
export class ExceptionEventModel {
    /**
     * Fahrzeuge, die in diesem Tick eine Position geschrieben haben:
     * LOW_FUEL nach Tankstand, OFFLINE endet (Signal ist da).
     */
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

            if (applyLowFuel(patch.id, patch.fuel_level, nowMs)) {
                notify.add(patch.company_id);
            }
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

    /** Create/Update: Tank unter 15 % nur bei `DRIVING`; Status `OFFLINE`. */
    static syncVehicle(input: {
        id: number;
        status: VehicleStatus;
        fuel_level: number;
    }, nowMs = Date.now()): void {
        applyOfflineStatus(input.id, input.status, nowMs);

        if (input.status === "DRIVING") {
            applyLowFuel(input.id, input.fuel_level, nowMs);
            return;
        }

        if (!isLowFuelLevel(input.fuel_level)) {
            AlertModel.endOpenType(input.id, "LOW_FUEL", sqliteFromMs(nowMs));
        }
    }

    static resetForTests() {
        lastReport.clear();
    }
}
