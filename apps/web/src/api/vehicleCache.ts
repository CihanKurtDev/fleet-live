import type { Vehicle } from "@fleet-live/shared";

const vehicles = new Map<number, Vehicle>();

export function rememberVehicle(vehicle: Vehicle) {
    vehicles.set(vehicle.id, vehicle);
}

export function rememberVehicles(rows: Vehicle[]) {
    for (const vehicle of rows) {
        vehicles.set(vehicle.id, vehicle);
    }
}

export function peekVehicle(id: number): Vehicle | undefined {
    return vehicles.get(id);
}

export function forgetVehicles(ids: number[]) {
    for (const id of ids) {
        vehicles.delete(id);
    }
}
