import { stmt } from "../db/statements";

export type CompanyImportLookup = {
    plateToId: Map<string, number>;
    vinToId: Map<string, number>;
    driverNameToId: Map<string, number>;
    eligibility: Set<string>;
    drivingByDriverId: Map<number, { id: number; license_plate: string }>;
    vehicleCurrentDriverId: Map<number, number | null>;
};

export function loadCompanyImportLookup(
    companyId: number,
): CompanyImportLookup {
    const plateToId = new Map<string, number>();
    const vinToId = new Map<string, number>();
    const vehicleCurrentDriverId = new Map<number, number | null>();

    const vehicles = stmt(
        `
        SELECT id, license_plate, vin, current_driver_id, status
        FROM vehicles
        WHERE company_id = ?
        `,
    ).all(companyId) as Array<{
        id: number;
        license_plate: string;
        vin: string | null;
        current_driver_id: number | null;
        status: string;
    }>;

    const drivingByDriverId = new Map<
        number,
        { id: number; license_plate: string }
    >();

    for (const row of vehicles) {
        plateToId.set(row.license_plate.toLowerCase(), row.id);
        vehicleCurrentDriverId.set(row.id, row.current_driver_id);
        if (row.vin) {
            vinToId.set(row.vin, row.id);
        }
        if (row.status === "DRIVING" && row.current_driver_id !== null) {
            drivingByDriverId.set(row.current_driver_id, {
                id: row.id,
                license_plate: row.license_plate,
            });
        }
    }

    const driverNameToId = new Map<string, number>();
    const drivers = stmt(
        `
        SELECT id, name
        FROM drivers
        WHERE company_id = ?
        `,
    ).all(companyId) as Array<{ id: number; name: string }>;

    for (const row of drivers) {
        driverNameToId.set(row.name, row.id);
    }

    const eligibility = new Set<string>();
    const links = stmt(
        `
        SELECT d.name AS driver_name, v.license_plate
        FROM driver_vehicles dv
        INNER JOIN drivers d ON d.id = dv.driver_id
        INNER JOIN vehicles v ON v.id = dv.vehicle_id
        WHERE d.company_id = ? AND v.company_id = ?
        `,
    ).all(companyId, companyId) as Array<{
        driver_name: string;
        license_plate: string;
    }>;

    for (const row of links) {
        eligibility.add(
            `${row.driver_name.toLowerCase()}|${row.license_plate.toLowerCase()}`,
        );
    }

    return {
        plateToId,
        vinToId,
        driverNameToId,
        eligibility,
        drivingByDriverId,
        vehicleCurrentDriverId,
    };
}
