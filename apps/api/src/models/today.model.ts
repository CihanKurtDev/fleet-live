import {
    berlinTodayIso,
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

import { stmt } from "../db/statements";
import { AlertModel } from "./alert.model";
import { CompanyModel } from "./company.model";
import { DriverModel, LICENCE_DRIVING_SQL } from "./driver.model";
import { DueModel } from "./due.model";
import { VehicleModel } from "./vehicle.model";
import { DamageModel } from "./damage.model";
import { WorkshopModel } from "./workshop.model";

const emptyItem = {
    vehicle_id: null,
    driver_id: null,
    due_kind: null,
    due_on: null,
    alert_id: null,
    since: null,
    open_warnings: null,
    fuel_level: null,
    workshop: null,
    workshop_task: null,
    workshop_place: null,
    damage: null,
    vehicle_plate: null,
    vehicle_driving: null,
    phone: null,
} satisfies Partial<TodayItem>;

/** Oldest first; a date never set (a licence never checked) after the dated ones. */
const byDueDate = (a: DueListItem, b: DueListItem) =>
    (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999");

/**
 * Overdue rows: legal dates (HU, UVV, licence expiry) before the company's own
 * licence check, each oldest first.
 */
const byOverdue = (a: DueListItem, b: DueListItem) =>
    Number(a.kind === "licence_check") - Number(b.kind === "licence_check") ||
    byDueDate(a, b);

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
 * vehicles, drivers, open alerts, workshop stays), so every count equals the
 * list its chip opens: /fristen?state=…, /vehicles?filter=…,
 * /drivers?min_open_warnings=…, /alerts?type=OFFLINE.
 */
export class TodayModel {
    /**
     * `driverTalk: false` leaves out the drivers to talk to (names kept from
     * viewers). Workshop stays assigned to `userId` come first in their kind.
     */
    static forCompany(
        companyId: number,
        limit: number,
        options: { driverTalk?: boolean; userId?: number } = {},
    ): TodayResponse {
        const withTalk = options.driverTalk !== false;
        const workshop = WorkshopModel.tasksForCompany(companyId, options.userId ?? null);
        const unplanned = DamageModel.unplannedForCompany(companyId);
        const dueRows = DueModel.rowsForCompany(companyId);
        const today = berlinTodayIso();
        const overdue = dueRows
            .filter((row) => row.state === "overdue")
            .sort(byOverdue);
        const dueToday = dueRows
            .filter((row) => row.state === "soon" && row.due_on === today)
            .sort(byDueDate);
        const soon = dueRows
            .filter((row) => row.state === "soon" && row.due_on !== today)
            .sort(byDueDate);
        const licenceDriving = stmt(
            `
            SELECT d.id, d.name, d.phone, d.licence_expires_on,
                v.id AS vehicle_id, v.license_plate, v.status = 'DRIVING' AS driving
            FROM drivers d
            JOIN vehicles v ON v.current_driver_id = d.id
            WHERE d.company_id = ? AND ${LICENCE_DRIVING_SQL}
            ORDER BY d.licence_expires_on, d.id
            `,
        ).all(companyId) as {
            id: number;
            name: string;
            phone: string | null;
            licence_expires_on: string;
            vehicle_id: number;
            license_plate: string;
            driving: number;
        }[];
        const currentDriverPhone = (vehicleId: number) =>
            (
                stmt(
                    `SELECT d.phone FROM vehicles v JOIN drivers d ON d.id = v.current_driver_id WHERE v.id = ?`,
                ).get(vehicleId) as { phone: string | null } | undefined
            )?.phone ?? null;

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
            licence_driving: licenceDriving.slice(0, limit).map((row) => ({
                ...emptyItem,
                kind: "licence_driving",
                key: `licence_driving:${row.id}`,
                vehicle_id: Number(row.vehicle_id),
                driver_id: Number(row.id),
                subject: row.name,
                due_kind: "licence_expiry",
                due_on: row.licence_expires_on,
                vehicle_plate: row.license_plate,
                vehicle_driving: Boolean(row.driving),
                phone: row.phone,
            })),
            deadline_today: dueToday
                .slice(0, limit)
                .map((row, index) => deadlineItem("deadline_today", row, index)),
            deadline_overdue: overdue
                .slice(0, limit)
                .map((row, index) => deadlineItem("deadline_overdue", row, index)),
            workshop_due: workshop.slice(0, limit).map((task) => ({
                ...emptyItem,
                kind: "workshop_due",
                key: `workshop_due:${task.vehicle_id}`,
                vehicle_id: task.vehicle_id,
                subject: task.license_plate,
                since: task.since,
                workshop: task.visit,
                workshop_task: task.task,
                workshop_place: task.place,
            })),
            damage_unplanned: unplanned.slice(0, limit).map(({ license_plate, ...damage }) => ({
                ...emptyItem,
                kind: "damage_unplanned",
                key: `damage_unplanned:${damage.id}`,
                vehicle_id: damage.vehicle_id,
                subject: license_plate,
                since: damage.occurred_on,
                damage,
            })),
            driver_talk: (withTalk ? talk.data : []).map((driver) => ({
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
                phone: currentDriverPhone(alert.vehicle_id),
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
            licence_driving: licenceDriving.length,
            deadline_today: dueToday.length,
            deadline_overdue: overdue.length,
            workshop_due: workshop.length,
            damage_unplanned: unplanned.length,
            driver_talk: withTalk ? talk.meta.total : 0,
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
