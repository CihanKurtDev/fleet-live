import type { VehicleType } from "@fleet-live/shared";

/**
 * What the simulated tracker reads besides its GPS. A truck's tracker sits on
 * the FMS plug and reports the dashboard odometer with every ping; vans and
 * cars get a plain GPS box that only reports where it is, so the app counts
 * their reading from the distance. Real devices replace this: the app only
 * looks at whether a ping carries a reading.
 */
export function simReadsDashboard(vehicleType: VehicleType | null): boolean {
    return vehicleType === "TRUCK";
}

/** Where a truck's dashboard stands when nobody entered a reading: 60.000–600.000 km. */
function seedDashboardMeters(vehicleId: number): number {
    return (60_000 + ((vehicleId * 7_919) % 540_000)) * 1000;
}

/**
 * The dashboard reading the device reports after a ping that covered
 * `meters`, or `null` for a GPS box. The dashboard counts the same road the
 * trip got; it starts at the stored reading (or a seeded one).
 */
export function simDashboardMeters(
    vehicle: { id: number; vehicle_type: VehicleType | null; odometer_m: number | null },
    meters: number,
): number | null {
    if (!simReadsDashboard(vehicle.vehicle_type)) {
        return null;
    }

    return (vehicle.odometer_m ?? seedDashboardMeters(vehicle.id)) + meters;
}
