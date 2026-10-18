import {
    DRIVER_TALK_MIN_OPEN_WARNINGS,
    parseAlertListQuery,
    parseDriverListQuery,
    parseVehicleListQuery,
    resolveDueSettings,
    TODAY_KINDS,
    type DueListItem,
    type TodayCounts,
    type TodayItem,
    type TodayKind,
    type TodayResponse,
} from "@fleet-live/shared";

import { AlertModel } from "./alert.model";
import { CompanyModel } from "./company.model";
import { DriverModel } from "./driver.model";
import { DueModel } from "./due.model";
import { VehicleModel } from "./vehicle.model";

const emptyItem = {
    vehicle_id: null,
    driver_id: null,
    due_kind: null,
    due_on: null,
    alert_id: null,
    since: null,
    open_warnings: null,
    fuel_level: null,
} satisfies Partial<TodayItem>;

/** Never-set dates first (a licence never checked), then the oldest. */
const byDueDate = (a: DueListItem, b: DueListItem) =>
    (a.due_on ?? "").localeCompare(b.due_on ?? "");

const deadlineItem = (
    kind: TodayKind,
    row: DueListItem,
    index: number,
): TodayItem => ({
    ...emptyItem,
    kind,
    key: `${kind}:${row.kind}:${row.vehicle_id ?? `d${row.driver_id}`}:${index}`,
    vehicle_id: row.vehicle_id,
    driver_id: row.driver_id,
    subject: row.label,
    due_kind: row.kind,
    due_on: row.due_on,
});

/**
 * One kind can hold thousands of rows (e.g. licence checks never done), so a
 * plain ranking would show only that kind. Every kind with tasks gets an equal
 * share of the slots; slots a kind cannot fill go to the more urgent kinds.
 * The result stays in kind order, most urgent first.
 */
const shareSlots = (
    byKind: Record<TodayKind, TodayItem[]>,
    limit: number,
): TodayItem[] => {
    const present = TODAY_KINDS.filter((kind) => byKind[kind].length > 0);
    const taken = new Map<TodayKind, number>(present.map((kind) => [kind, 0]));
    let left = limit;

    // Round by round: one more row for each kind that still has rows.
    while (left > 0) {
        let added = false;

        for (const kind of present) {
            const count = taken.get(kind) ?? 0;

            if (left > 0 && count < byKind[kind].length) {
                taken.set(kind, count + 1);
                left -= 1;
                added = true;
            }
        }

        if (!added) {
            break;
        }
    }

    return present.flatMap((kind) => byKind[kind].slice(0, taken.get(kind)));
};

/**
 * The Schicht task list. It only reads the lists that already exist (deadlines,
 * vehicles, drivers, open alerts), so every count equals the list its chip
 * opens: /fristen?state=…, /vehicles?filter=…, /drivers?min_open_warnings=…,
 * /alerts?type=OFFLINE.
 */
export class TodayModel {
    static forCompany(companyId: number, limit: number): TodayResponse {
        const dueRows = DueModel.rowsForCompany(companyId);
        const overdue = dueRows
            .filter((row) => row.state === "overdue")
            .sort(byDueDate);
        const soon = dueRows
            .filter((row) => row.state === "soon")
            .sort(byDueDate);

        const talk = DriverModel.list(
            parseDriverListQuery({
                min_open_warnings: DRIVER_TALK_MIN_OPEN_WARNINGS,
                sort: "open_warnings",
                dir: "desc",
                limit,
            }),
            companyId,
        );
        const offline = AlertModel.listForCompany(
            companyId,
            parseAlertListQuery({
                filter: "open",
                type: "OFFLINE",
                sort: "created_at",
                dir: "asc",
                limit,
            }),
        );
        const lowFuel = VehicleModel.list(
            parseVehicleListQuery({
                filter: "low_fuel",
                sort: "fuel_level",
                dir: "asc",
                limit,
            }),
            companyId,
        );

        const byKind: Record<TodayKind, TodayItem[]> = {
            deadline_overdue: overdue
                .slice(0, limit)
                .map((row, index) => deadlineItem("deadline_overdue", row, index)),
            driver_talk: talk.data.map((driver) => ({
                ...emptyItem,
                kind: "driver_talk",
                key: `driver_talk:${driver.id}`,
                driver_id: driver.id,
                subject: driver.name,
                open_warnings: driver.open_warnings,
                since: driver.last_warning_at,
            })),
            offline: offline.data.map((alert) => ({
                ...emptyItem,
                kind: "offline",
                key: `offline:${alert.id}`,
                vehicle_id: alert.vehicle_id,
                subject: alert.license_plate,
                alert_id: alert.id,
                since: alert.created_at,
            })),
            low_fuel: lowFuel.data.map((vehicle) => ({
                ...emptyItem,
                kind: "low_fuel",
                key: `low_fuel:${vehicle.id}`,
                vehicle_id: vehicle.id,
                subject: vehicle.license_plate,
                fuel_level: vehicle.fuel_level,
            })),
            deadline_soon: soon
                .slice(0, limit)
                .map((row, index) => deadlineItem("deadline_soon", row, index)),
        };

        const counts: TodayCounts = {
            deadline_overdue: overdue.length,
            driver_talk: talk.meta.total,
            offline: offline.meta.total,
            low_fuel: lowFuel.meta.total,
            deadline_soon: soon.length,
        };

        return {
            data: shareSlots(byKind, limit),
            meta: {
                counts,
                total: TODAY_KINDS.reduce((sum, kind) => sum + counts[kind], 0),
                limit,
                lead_days: resolveDueSettings(CompanyModel.dueSettings(companyId))
                    .lead_days,
            },
        };
    }
}
