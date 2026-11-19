import { stmt } from "../db/statements";
import { SiteModel } from "../models/site.model";
import { isCompanySimRunning } from "../lib/simControl";
import { DriveModel } from "../models/drive.model";
import { TelemetryModel } from "../models/telemetry.model";

/**
 * In the demo a device starts reporting once its vehicle has a current driver:
 * it says it stands, where its home depot is if it knows no other place. Real
 * devices replace this. Returns the companies whose vehicles changed.
 */
export function playFirstReports(): number[] {
    const companies = new Set<number>();
    const rows = stmt(
        `SELECT v.id, v.company_id, v.last_telemetry_id, s.latitude, s.longitude
         FROM vehicles v
         LEFT JOIN sites s ON s.id = v.home_site_id
         WHERE v.active = 1 AND v.status = 'UNCONNECTED' AND v.current_driver_id IS NOT NULL`,
    ).all() as Array<{
        id: number;
        company_id: number;
        last_telemetry_id: number | null;
        latitude: number | null;
        longitude: number | null;
    }>;

    for (const row of rows) {
        if (!isCompanySimRunning(row.company_id)) {
            continue;
        }

        if (row.last_telemetry_id === null && row.latitude !== null && row.longitude !== null) {
            TelemetryModel.recordMovedTo(row.id, row.latitude, row.longitude);
        }

        DriveModel.report(row.id, row.company_id, "IDLE");
        companies.add(row.company_id);
    }

    // The report stands at the home depot: the vehicle is in it now.
    for (const companyId of companies) {
        SiteModel.refreshInside(companyId);
    }

    return [...companies];
}
