import type { Driver, Vehicle, VehicleStatus } from "@fleet-live/shared";

import { vehicleStatusLabel } from "../vehicles/vehicleStatus";

export type AssignmentStatusLine = {
    eligibility: string;
    activity?: { label: string; tone: "ok" | "muted" | "danger" };
    plate?: string;
};

const activity = (status: VehicleStatus | null | undefined) => {
    if (!status) {
        return undefined;
    }
    if (status === "DRIVING") {
        return { label: "Auf Fahrt", tone: "ok" as const };
    }
    if (status === "OFFLINE") {
        return { label: "Kein Signal", tone: "danger" as const };
    }
    // IDLE/STOPPED: mockup treats Feierabend as muted; Standby the same.
    return { label: vehicleStatusLabel(status), tone: "muted" as const };
};

export const assignmentStatus = (
    eligibility: string,
    status?: VehicleStatus | null,
    plate?: string | null,
): AssignmentStatusLine => ({
    eligibility,
    activity: activity(status),
    plate: plate || undefined,
});

export const driverPickerStatus = (driver: Driver): AssignmentStatusLine => {
    if (driver.current_vehicle_plate) {
        return assignmentStatus(
            "Freigegeben",
            driver.current_vehicle_status,
            driver.current_vehicle_plate,
        );
    }

    if (driver.vehicle_count > 0) {
        return {
            eligibility:
                driver.vehicle_count === 1
                    ? "Frei · 1 Fahrzeug"
                    : `Frei · ${driver.vehicle_count} Fahrzeuge`,
        };
    }

    return { eligibility: "Frei" };
};

export const canAutoCurrentDriver = (driver: Driver | undefined): boolean =>
    driver === undefined || driver.current_vehicle_status !== "DRIVING";

export const canAutoCurrentVehicle = (vehicle: Vehicle | undefined): boolean =>
    vehicle === undefined || vehicle.status !== "DRIVING";
