export type VehicleStatus =
    | "IDLE"
    | "DRIVING"
    | "STOPPED"
    | "OFFLINE";

export type VehicleTableRow = {
    id: number;
    license_plate: string;
    driver_name: string;
    fuel_level: number;
    status: VehicleStatus;
    speed: number | null;
    activeAlerts: number;
};