import {
    buildDueRows,
    queryDueRows,
    utcTodayIso,
    type DueListItem,
    type DueListQuery,
    type DueListResponse,
    type DriverDueInput,
    type VehicleDueInput,
} from "@fleet-live/shared";
import { stmt } from "../db/statements";

const VEHICLES = `
    SELECT id, license_plate, hu_due_on, uvv_due_on
    FROM vehicles
    WHERE company_id = ?
`;

const DRIVERS = `
    SELECT id, name, licence_expires_on, licence_checked_on
    FROM drivers
    WHERE company_id = ?
`;

export class DueModel {
    static rowsForCompany(
        companyId: number,
        today = utcTodayIso(),
    ): DueListItem[] {
        const vehicles = stmt(VEHICLES).all(companyId) as VehicleDueInput[];
        const drivers = stmt(DRIVERS).all(companyId) as DriverDueInput[];

        return buildDueRows({ vehicles, drivers, today });
    }

    static listForCompany(
        companyId: number,
        query: DueListQuery,
    ): DueListResponse {
        return queryDueRows(this.rowsForCompany(companyId), query);
    }
}
