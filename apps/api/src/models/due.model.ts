import {
    berlinTodayIso,
    buildConfiguredDueRows,
    dueRule,
    queryDueRows,
    type DueListItem,
    type DueListQuery,
    type DueListResponse,
} from "@fleet-live/shared";
import { stmt } from "../db/statements";
import { CompanyModel } from "./company.model";

const VEHICLES = `
    SELECT id, license_plate, active, hu_due_on, uvv_due_on, uvv_checked_on
    FROM vehicles
    WHERE company_id = ? AND active = 1
`;

const DRIVERS = `
    SELECT id, name, active, licence_expires_on, licence_checked_on
    FROM drivers
    WHERE company_id = ? AND active = 1
`;

type VehicleDueRow = {
    id: number;
    license_plate: string;
    active: number;
    hu_due_on: string | null;
    uvv_due_on: string | null;
    uvv_checked_on: string | null;
};

type DriverDueRow = {
    id: number;
    name: string;
    active: number;
    licence_expires_on: string | null;
    licence_checked_on: string | null;
};

function isActive(value: number): boolean {
    return Number(value) === 1;
}

export class DueModel {
    static rowsForCompany(
        companyId: number,
        today = berlinTodayIso(),
    ): DueListItem[] {
        const vehicles = stmt(VEHICLES).all(companyId) as VehicleDueRow[];
        const drivers = stmt(DRIVERS).all(companyId) as DriverDueRow[];
        const settings = CompanyModel.dueSettings(companyId);
        const leadDays = settings?.due_lead_days ?? dueRule("hu").lead_days;
        const checkMonths =
            settings?.licence_check_months ??
            dueRule("licence_check").interval_months ??
            6;

        return buildConfiguredDueRows({
            today,
            leadDays,
            licenceCheckMonths: checkMonths,
            vehicles: vehicles.map((vehicle) => ({
                id: vehicle.id,
                license_plate: vehicle.license_plate,
                active: isActive(vehicle.active),
                hu_due_on: vehicle.hu_due_on,
                uvv_due_on: vehicle.uvv_due_on,
                uvv_checked_on: vehicle.uvv_checked_on,
            })),
            drivers: drivers.map((driver) => ({
                id: driver.id,
                name: driver.name,
                active: isActive(driver.active),
                licence_expires_on: driver.licence_expires_on,
                licence_checked_on: driver.licence_checked_on,
            })),
        });
    }

    static listForCompany(
        companyId: number,
        query: DueListQuery,
    ): DueListResponse {
        return queryDueRows(this.rowsForCompany(companyId), query);
    }
}
