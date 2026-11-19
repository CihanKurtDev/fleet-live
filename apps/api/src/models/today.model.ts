import {
    addIsoDays,
    berlinTodayIso,
    endingUntil,
    monthEndIso,
    nextWorkday,
    parseAlertListQuery,
    resolveDueSettings,
    TODAY_GROUP_MAX,
    TODAY_KINDS,
    WEEK_MIN_DAYS,
    type DueListItem,
    type TodayCounts,
    type TodayGroup,
    type TodayItem,
    type TodayKind,
    type TodayResponse,
    type TodayStay,
    type WeekDay,
    type WeekItem,
    type WorkshopSummary,
} from "@fleet-live/shared";

import { stmt } from "../db/statements";
import { withoutBringer, withoutDriver } from "../lib/driverNames";
import { AlertModel } from "./alert.model";
import { CompanyModel } from "./company.model";
import { DamageModel } from "./damage.model";
import { DueModel } from "./due.model";
import { WorkshopModel } from "./workshop.model";

const emptyItem = {
    vehicle_id: null,
    driver_id: null,
    due_kind: null,
    due_on: null,
    alert_id: null,
    since: null,
    workshop: null,
    workshop_task: null,
    workshop_place: null,
    damage: null,
    vehicle_plate: null,
    vehicle_driving: null,
    driver_name: null,
    phone: null,
    stay: null,
    trips_since: null,
    km_since: null,
    replacement: null,
} satisfies Partial<TodayItem>;

/** A vehicle with a current driver, or a driver current on a vehicle. */
type InUse = {
    vehicle_id: number;
    plate: string;
    driving: boolean;
    driver_id: number;
    driver_name: string;
    phone: string | null;
};

const loadInUse = (companyId: number) => {
    const rows = stmt(
        `
        SELECT v.id AS vehicle_id, v.license_plate AS plate, v.status = 'DRIVING' AS driving,
            d.id AS driver_id, d.name AS driver_name, d.phone
        FROM vehicles v
        JOIN drivers d ON d.id = v.current_driver_id
        WHERE v.company_id = ? AND v.active = 1
        `,
    ).all(companyId) as {
        vehicle_id: number;
        plate: string;
        driving: number;
        driver_id: number;
        driver_name: string;
        phone: string | null;
    }[];
    const list: InUse[] = rows.map((row) => ({
        vehicle_id: Number(row.vehicle_id),
        plate: row.plate,
        driving: Boolean(row.driving),
        driver_id: Number(row.driver_id),
        driver_name: row.driver_name,
        phone: row.phone,
    }));

    return {
        byVehicle: new Map(list.map((row) => [row.vehicle_id, row])),
        byDriver: new Map(list.map((row) => [row.driver_id, row])),
    };
};

/** HU is a month („2026-11“): it runs to the month's last day. */
const dueDate = (row: DueListItem) =>
    row.due_on === null ? null : row.due_on.length === 7 ? monthEndIso(row.due_on) : row.due_on;

const byDate = (a: DueListItem, b: DueListItem) =>
    (dueDate(a) ?? "9999").localeCompare(dueDate(b) ?? "9999");

const toStay = (summary: WorkshopSummary | undefined): TodayStay | null =>
    summary
        ? { id: summary.id, state: summary.state, planned_on: summary.planned_on, planned_time: summary.planned_time, place: summary.place }
        : null;

/** A free driver with a licence valid past `validAfter` who may drive the vehicle. */
const replacementFor = (vehicleId: number, validAfter: string) =>
    (stmt(
        `
        SELECT d.id, d.name
        FROM driver_vehicles dv
        JOIN drivers d ON d.id = dv.driver_id
        WHERE dv.vehicle_id = ?
          AND d.active = 1
          AND d.licence_expires_on IS NOT NULL AND d.licence_expires_on > ?
          AND NOT EXISTS (SELECT 1 FROM vehicles x WHERE x.current_driver_id = d.id)
        ORDER BY d.name COLLATE NOCASE
        LIMIT 1
        `,
    ).get(vehicleId, validAfter) as { id: number; name: string } | undefined) ?? null;

/** Trips the driver started after the licence's last valid day. */
const tripsSince = (driverId: number, lastValidDay: string) => {
    const row = stmt(
        `
        SELECT COUNT(*) AS trips, COALESCE(SUM(distance_m), 0) AS metres
        FROM trips
        WHERE driver_id = ? AND started_at >= date(?, '+1 day') AND distance_m > 0
        `,
    ).get(driverId, lastValidDay) as { trips: number; metres: number };
    return { trips: Number(row.trips), km: Math.round(Number(row.metres) / 1000) };
};

/**
 * The Schicht blocks „Heute“ and „Als Nächstes planen“. It reads the lists
 * that already exist (deadlines, workshop tasks, damages, open alerts) and
 * keeps what is in use, so every count is a part of a tile on the page.
 */
export class TodayModel {
    /**
     * `driverNames: false` (names kept from viewers) leaves out the kinds and
     * week items that name a driver, and the driver on the other rows.
     * Workshop stays assigned to `userId` come first in their kind.
     */
    static forCompany(
        companyId: number,
        options: { driverNames?: boolean; userId?: number; today?: string } = {},
    ): TodayResponse {
        const withNames = options.driverNames !== false;
        const today = options.today ?? berlinTodayIso();
        const until = endingUntil(today);
        const next = nextWorkday(until);
        const leadDays = resolveDueSettings(CompanyModel.dueSettings(companyId)).lead_days;
        // The plan looks as far ahead as the tile „In N Tagen“, at least a week.
        const weekTo = addIsoDays(until, Math.max(leadDays, WEEK_MIN_DAYS));

        const inUse = loadInUse(companyId);
        const stays = WorkshopModel.openByVehicle(companyId);
        const rows = DueModel.rowsForCompany(companyId, today);

        const vehicleUse = (row: DueListItem) =>
            row.vehicle_id === null ? undefined : inUse.byVehicle.get(Number(row.vehicle_id));
        const driverUse = (row: DueListItem) =>
            row.driver_id === null ? undefined : inUse.byDriver.get(Number(row.driver_id));
        const isVehicleKind = (row: DueListItem) => row.kind === "hu" || row.kind === "uvv";
        const used = (row: DueListItem) => (isVehicleKind(row) ? vehicleUse(row) : driverUse(row));

        const deadlineItem = (kind: TodayKind, row: DueListItem, index: number): TodayItem => {
            const use = used(row);
            const vehicleRow = isVehicleKind(row);
            return {
                ...emptyItem,
                kind,
                key: `${kind}:${row.kind}:${row.vehicle_id ?? `d${row.driver_id}`}:${index}`,
                vehicle_id: vehicleRow ? row.vehicle_id : (use?.vehicle_id ?? null),
                driver_id: vehicleRow ? null : row.driver_id,
                subject: row.label,
                due_kind: row.kind,
                due_on: row.due_on,
                vehicle_plate: vehicleRow ? null : (use?.plate ?? null),
                vehicle_driving: use?.driving ?? null,
                driver_name: vehicleRow && withNames ? (use?.driver_name ?? null) : null,
                phone: withNames ? (use?.phone ?? null) : null,
                stay: vehicleRow && row.vehicle_id !== null ? toStay(stays.get(Number(row.vehicle_id))) : null,
            };
        };

        // Driving vehicles first: those break the rule right now.
        const drivingFirst = (a: DueListItem, b: DueListItem) =>
            Number(used(b)?.driving ?? false) - Number(used(a)?.driving ?? false) || byDate(a, b);

        const pick = (test: (row: DueListItem) => boolean, sort = byDate) =>
            rows.filter((row) => used(row) !== undefined && test(row)).sort(sort);

        const named = (row: DueListItem) => withNames || isVehicleKind(row);

        const licenceDriving = pick((row) => row.kind === "licence_expiry" && row.state === "overdue" && named(row));
        const deadlineOverdue = pick((row) => isVehicleKind(row) && row.state === "overdue", drivingFirst);
        const checkOverdue = pick((row) => row.kind === "licence_check" && row.state === "overdue" && named(row));
        const dateMissing = pick((row) => row.state === "missing" && row.kind !== "licence_check" && named(row));
        const endingSoon = (row: DueListItem) => row.state === "soon" && (dueDate(row) ?? "9999") <= until;
        const licenceEnding = pick((row) => row.kind === "licence_expiry" && endingSoon(row) && named(row));
        const deadlineEnding = pick(
            (row) => row.kind !== "licence_expiry" && endingSoon(row) && named(row),
            drivingFirst,
        );

        const licenceRow = (kind: TodayKind) => (row: DueListItem, index: number) => {
            const item = deadlineItem(kind, row, index);
            const lastValid = row.due_on ?? today;
            const since = kind === "licence_driving" && row.driver_id !== null
                ? tripsSince(Number(row.driver_id), lastValid)
                : null;
            return {
                ...item,
                trips_since: since?.trips ?? null,
                km_since: since?.km ?? null,
                replacement: item.vehicle_id !== null ? replacementFor(item.vehicle_id, until) : null,
            };
        };

        const workshop = WorkshopModel.tasksForCompany(companyId, options.userId ?? null);
        const unplanned = DamageModel.unplannedForCompany(companyId);
        const offline = AlertModel.listForCompany(
            companyId,
            parseAlertListQuery({ filter: "open", type: "OFFLINE", sort: "created_at", dir: "asc", limit: TODAY_GROUP_MAX }),
        );

        const lists: Record<TodayKind, { count: number; items: () => TodayItem[] }> = {
            licence_driving: {
                count: licenceDriving.length,
                items: () => licenceDriving.slice(0, TODAY_GROUP_MAX).map(licenceRow("licence_driving")),
            },
            deadline_overdue: {
                count: deadlineOverdue.length,
                items: () => deadlineOverdue.slice(0, TODAY_GROUP_MAX).map((row, i) => deadlineItem("deadline_overdue", row, i)),
            },
            workshop_due: {
                count: workshop.length,
                items: () =>
                    workshop.slice(0, TODAY_GROUP_MAX).map((task) => ({
                        ...emptyItem,
                        kind: "workshop_due" as const,
                        key: `workshop_due:${task.vehicle_id}`,
                        vehicle_id: task.vehicle_id,
                        subject: task.license_plate,
                        since: task.since,
                        workshop: withNames || !task.visit ? task.visit : withoutBringer(task.visit),
                        workshop_task: task.task,
                        workshop_place: task.place,
                    })),
            },
            damage_unplanned: {
                count: unplanned.length,
                items: () =>
                    unplanned.slice(0, TODAY_GROUP_MAX).map(({ license_plate, ...damage }) => ({
                        ...emptyItem,
                        kind: "damage_unplanned" as const,
                        key: `damage_unplanned:${damage.id}`,
                        vehicle_id: damage.vehicle_id,
                        subject: license_plate,
                        since: damage.occurred_on,
                        damage: withNames ? damage : withoutDriver(damage),
                    })),
            },
            offline: {
                count: offline.meta.total,
                items: () =>
                    offline.data.map((alert) => {
                        const use = inUse.byVehicle.get(alert.vehicle_id);
                        return {
                            ...emptyItem,
                            kind: "offline" as const,
                            key: `offline:${alert.id}`,
                            vehicle_id: alert.vehicle_id,
                            subject: alert.license_plate,
                            alert_id: alert.id,
                            since: alert.created_at,
                            driver_name: withNames ? (use?.driver_name ?? null) : null,
                            phone: withNames ? (use?.phone ?? null) : null,
                        };
                    }),
            },
            check_overdue: {
                count: checkOverdue.length,
                items: () => checkOverdue.slice(0, TODAY_GROUP_MAX).map((row, i) => deadlineItem("check_overdue", row, i)),
            },
            date_missing: {
                count: dateMissing.length,
                items: () => dateMissing.slice(0, TODAY_GROUP_MAX).map((row, i) => deadlineItem("date_missing", row, i)),
            },
            licence_ending: {
                count: licenceEnding.length,
                items: () => licenceEnding.slice(0, TODAY_GROUP_MAX).map(licenceRow("licence_ending")),
            },
            deadline_ending: {
                count: deadlineEnding.length,
                items: () => deadlineEnding.slice(0, TODAY_GROUP_MAX).map((row, i) => deadlineItem("deadline_ending", row, i)),
            },
        };

        const counts = Object.fromEntries(TODAY_KINDS.map((kind) => [kind, lists[kind].count])) as TodayCounts;
        const groups: TodayGroup[] = TODAY_KINDS.filter((kind) => counts[kind] > 0).map((kind) => ({
            kind,
            count: counts[kind],
            items: lists[kind].items(),
        }));

        // The plan: what runs out or comes due after `until`, only days that have something.
        const byDay = new Map<string, WeekItem[]>();
        const add = (date: string, item: WeekItem) => {
            const list = byDay.get(date) ?? [];
            list.push(item);
            byDay.set(date, list);
        };

        rows.filter((row) => {
            const date = dueDate(row);
            return row.state === "soon" && date !== null && date > until && date <= weekTo && used(row) !== undefined && named(row);
        })
            .sort(byDate)
            .forEach((row) => {
                const use = used(row);
                const vehicleRow = isVehicleKind(row);
                const date = dueDate(row) as string;
                add(date, {
                    key: `${row.kind}:${row.vehicle_id ?? `d${row.driver_id}`}`,
                    kind: row.kind,
                    due_on: date,
                    vehicle_id: use?.vehicle_id ?? row.vehicle_id,
                    driver_id: vehicleRow ? null : row.driver_id,
                    subject: row.label,
                    vehicle_plate: vehicleRow ? null : (use?.plate ?? null),
                    driver_name: vehicleRow && withNames ? (use?.driver_name ?? null) : null,
                    vehicle_driving: use?.driving ?? false,
                    stay: vehicleRow && row.vehicle_id !== null ? toStay(stays.get(Number(row.vehicle_id))) : null,
                });
            });

        const planned = stmt(
            `
            SELECT w.id, w.vehicle_id, v.license_plate, w.planned_on, w.planned_time, w.place,
                v.status = 'DRIVING' AS driving
            FROM workshop_visits w
            JOIN vehicles v ON v.id = w.vehicle_id
            WHERE v.company_id = ? AND w.state = 'PLANNED' AND w.planned_on > ? AND w.planned_on <= ?
            ORDER BY w.planned_on, w.planned_time, v.license_plate
            `,
        ).all(companyId, until, weekTo) as {
            id: number;
            vehicle_id: number;
            license_plate: string;
            planned_on: string;
            planned_time: string | null;
            place: string;
            driving: number;
        }[];
        for (const stay of planned) {
            add(stay.planned_on, {
                key: `workshop:${stay.id}`,
                kind: "workshop",
                due_on: stay.planned_on,
                vehicle_id: Number(stay.vehicle_id),
                driver_id: null,
                subject: stay.license_plate,
                vehicle_plate: null,
                driver_name: null,
                vehicle_driving: Boolean(stay.driving),
                stay: { id: Number(stay.id), state: "PLANNED", planned_on: stay.planned_on, planned_time: stay.planned_time, place: stay.place },
            });
        }

        const week: WeekDay[] = [...byDay.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, items]) => ({ date, count: items.length, items: items.slice(0, TODAY_GROUP_MAX) }));

        return {
            data: { groups, week },
            meta: {
                today,
                ending_until: until,
                next_workday: next,
                counts,
                total: TODAY_KINDS.reduce((sum, kind) => sum + counts[kind], 0),
                week_until: weekTo,
                week_total: week.reduce((sum, day) => sum + day.count, 0),
                lead_days: leadDays,
            },
        };
    }
}
