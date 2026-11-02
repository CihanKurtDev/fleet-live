import {
    WORKSHOP_PAST_LIMIT,
    WORKSHOP_TASKS,
    berlinTodayIso,
    isLicenceExpired,
    parseWorkshopFinish,
    parseWorkshopReasons as parseReasons,
    type VehicleWorkshop,
    type WorkshopBringer,
    type WorkshopCreateInput,
    type WorkshopEvent,
    type WorkshopEventAction,
    type WorkshopPatch,
    type WorkshopPlace,
    type WorkshopSummary,
    type WorkshopTask,
    type WorkshopVisit,
} from "@fleet-live/shared";

import { withTransaction } from "../db/database";
import { stmt } from "../db/statements";
import { VEHICLE_AVAILABILITY_SQL, WORKSHOP_TASK_SQL } from "../db/vehicleConcepts";
import { DamageModel } from "./damage.model";
import { OdometerModel } from "./odometer.model";
import { WorkshopPlaceModel } from "./workshopPlace.model";
import { AppError, NotFoundError, ValidationError } from "../lib/errors";
import { nowSqlite } from "../lib/sqlTime";

export type WorkshopActor = { id: number; name: string };

type VisitRow = Omit<WorkshopVisit, "workshop" | "reasons"> & {
    reasons: string;
    ws_name: string | null;
    ws_address: string | null;
    ws_phone: string | null;
    ws_latitude: number | null;
    ws_longitude: number | null;
    ws_radius_m: number | null;
};

type EventRow = Omit<WorkshopEvent, "details"> & { details: string | null };

type VehicleRow = {
    id: number;
    license_plate: string;
    status: string;
    out_of_service_since: string | null;
    at_workshop_id: number | null;
};

/** A row of „Heute dran“: what a workshop stay needs from someone today. */
export type WorkshopTaskRow = {
    vehicle_id: number;
    license_plate: string;
    task: WorkshopTask;
    visit: WorkshopVisit | null;
    place: Pick<WorkshopPlace, "id" | "name" | "phone"> | null;
    since: string | null;
};

/** What the simulator needs to play a workshop trip or a pickup. */
export type WorkshopSimTarget = {
    vehicle_id: number;
    company_id: number;
    kind: "to_workshop" | "pickup";
    transport: WorkshopVisit["transport"];
    driving: boolean;
    has_driver: boolean;
    there: boolean;
    planned_time: string | null;
    latitude: number | null;
    longitude: number | null;
};

const VISIT_COLUMNS = `
    w.id,
    w.vehicle_id,
    v.license_plate,
    v.hu_due_on,
    w.reasons,
    w.transport,
    w.state,
    w.place,
    w.workshop_id,
    w.planned_on,
    w.planned_time,
    w.expected_on,
    w.bring_driver_id,
    bd.name AS bring_driver_name,
    w.assignee_user_id,
    u.name AS assignee_name,
    w.note,
    w.arrived_on,
    w.arrived_at,
    w.arrived_by,
    w.finished_on,
    w.picked_up_at,
    w.cost_cents,
    w.result_note,
    w.created_at,
    ws.name AS ws_name,
    ws.address AS ws_address,
    ws.phone AS ws_phone,
    ws.latitude AS ws_latitude,
    ws.longitude AS ws_longitude,
    ws.radius_m AS ws_radius_m
`;

const VISIT_FROM = `
    FROM workshop_visits w
    JOIN vehicles v ON v.id = w.vehicle_id
    LEFT JOIN users u ON u.id = w.assignee_user_id
    LEFT JOIN drivers bd ON bd.id = w.bring_driver_id
    LEFT JOIN workshops ws ON ws.id = w.workshop_id
`;

const OPEN = `w.state IN ('PLANNED', 'IN_WORKSHOP')`;

function toVisit(row: VisitRow): WorkshopVisit {
    const { ws_name, ws_address, ws_phone, ws_latitude, ws_longitude, ws_radius_m, ...visit } = row;
    return {
        ...visit,
        reasons: parseReasons(visit.reasons),
        id: Number(visit.id),
        vehicle_id: Number(visit.vehicle_id),
        workshop_id: visit.workshop_id === null ? null : Number(visit.workshop_id),
        bring_driver_id: visit.bring_driver_id === null ? null : Number(visit.bring_driver_id),
        assignee_user_id:
            visit.assignee_user_id === null ? null : Number(visit.assignee_user_id),
        cost_cents: visit.cost_cents === null ? null : Number(visit.cost_cents),
        workshop:
            visit.workshop_id === null || ws_name === null
                ? null
                : {
                      id: Number(visit.workshop_id),
                      name: ws_name,
                      address: ws_address,
                      phone: ws_phone,
                      latitude: Number(ws_latitude),
                      longitude: Number(ws_longitude),
                      radius_m: Number(ws_radius_m),
                  },
    };
}

function toEvent(row: EventRow): WorkshopEvent {
    return {
        ...row,
        id: Number(row.id),
        details: row.details ? (JSON.parse(row.details) as WorkshopEvent["details"]) : null,
    };
}

function conflict(code: string, message: string, field = "state"): AppError {
    return new AppError(409, code, message, { [field]: message });
}

function vehicleOf(vehicleId: number, companyId: number): VehicleRow {
    const vehicle = stmt(
        `
        SELECT id, license_plate, status, out_of_service_since, at_workshop_id
        FROM vehicles
        WHERE id = ? AND company_id = ?
        `,
    ).get(vehicleId, companyId) as VehicleRow | undefined;

    if (!vehicle) {
        throw new NotFoundError();
    }

    return vehicle;
}

function visitOf(visitId: number, companyId: number): WorkshopVisit {
    const row = stmt(
        `SELECT ${VISIT_COLUMNS} ${VISIT_FROM} WHERE w.id = ? AND v.company_id = ?`,
    ).get(visitId, companyId) as VisitRow | undefined;

    if (!row) {
        throw new NotFoundError("Werkstatt-Aufenthalt nicht gefunden.");
    }

    return toVisit(row);
}

function checkAssignee(userId: number, companyId: number) {
    const member = stmt(
        `
        SELECT 1 FROM company_memberships
        WHERE user_id = ? AND company_id = ? AND role = 'dispatcher'
        `,
    ).get(userId, companyId);

    if (!member) {
        throw new ValidationError("Zuständig muss ein Dispatcher dieser Firma sein.", {
            assignee_user_id: "Zuständig muss ein Dispatcher dieser Firma sein.",
        });
    }
}

function workshopOf(workshopId: number, companyId: number) {
    const place = WorkshopPlaceModel.find(workshopId, companyId);
    if (!place) {
        throw new ValidationError("Diese Werkstatt gibt es in dieser Firma nicht.", {
            workshop_id: "Diese Werkstatt gibt es in dieser Firma nicht.",
        });
    }
    return place;
}

/** Who brings it must be allowed to drive it, and hold a valid licence. */
function checkBringDriver(driverId: number | null | undefined, vehicleId: number) {
    if (driverId === null || driverId === undefined) {
        return;
    }

    const driver = stmt(
        `
        SELECT d.name, d.licence_expires_on
        FROM driver_vehicles dv JOIN drivers d ON d.id = dv.driver_id
        WHERE dv.driver_id = ? AND dv.vehicle_id = ?
        `,
    ).get(driverId, vehicleId) as { name: string; licence_expires_on: string | null } | undefined;

    if (!driver) {
        throw new ValidationError("Bringt hin muss ein freigegebener Fahrer dieses Fahrzeugs sein.", {
            bring_driver_id: "Bringt hin muss ein freigegebener Fahrer dieses Fahrzeugs sein.",
        });
    }

    if (isLicenceExpired(driver.licence_expires_on, berlinTodayIso())) {
        const message = `Der Führerschein von ${driver.name} ist abgelaufen; so kann niemand das Fahrzeug hinbringen.`;
        throw new ValidationError(message, { bring_driver_id: message });
    }
}

/** A vehicle that cannot be driven is towed or fetched, not brought by a driver. */
function checkTransport(transport: WorkshopVisit["transport"], vehicleId: number, plate: string) {
    if (transport === "DRIVER" && DamageModel.notDrivable(vehicleId)) {
        const message = `${plate} ist nicht fahrbereit: Abschleppen oder die Werkstatt holt es ab.`;
        throw new AppError(409, "VEHICLE_NOT_DRIVABLE", message, { transport: message });
    }
}

function logEvent(
    visitId: number,
    action: WorkshopEventAction,
    actor: WorkshopActor | null,
    details: WorkshopEvent["details"] = null,
) {
    stmt(
        `
        INSERT INTO workshop_visit_events (visit_id, action, actor_user_id, actor_name, details)
        VALUES (?, ?, ?, ?, ?)
        `,
    ).run(
        visitId,
        action,
        actor?.id ?? null,
        actor?.name ?? null,
        details ? JSON.stringify(details) : null,
    );
}

/** A vehicle in a workshop or out of service has no current driver. */
function releaseCurrentDriver(vehicleId: number) {
    stmt(
        `UPDATE vehicles SET current_driver_id = NULL, driver_name = NULL WHERE id = ?`,
    ).run(vehicleId);
}

function refuseDriving(vehicle: VehicleRow, what: string) {
    if (vehicle.status === "DRIVING") {
        throw conflict(
            "VEHICLE_DRIVING",
            `${vehicle.license_plate} ist auf Fahrt. ${what}, sobald die Fahrt endet.`,
        );
    }
}

/** The stay starts in the workshop: arrived now, the driver goes free. */
function markArrived(
    visitId: number,
    vehicleId: number,
    by: "POSITION" | "HAND",
    at: string,
    actor: WorkshopActor | null,
) {
    stmt(
        `
        UPDATE workshop_visits
        SET state = 'IN_WORKSHOP', arrived_on = ?, arrived_at = ?, arrived_by = ?
        WHERE id = ?
        `,
    ).run(berlinTodayIso(), at, by, visitId);
    releaseCurrentDriver(vehicleId);
    stmt(`UPDATE vehicles SET out_of_service_since = NULL WHERE id = ?`).run(vehicleId);
    logEvent(visitId, "arrived", actor, { by: by === "POSITION" ? "position" : "hand" });
}

function lastReportAt(vehicleId: number): string {
    const row = stmt(
        `
        SELECT substr(t.recorded_at, 1, 19) AS at
        FROM vehicles v JOIN telemetry t ON t.id = v.last_telemetry_id
        WHERE v.id = ?
        `,
    ).get(vehicleId) as { at: string } | undefined;
    return row?.at ?? nowSqlite();
}

export class WorkshopModel {
    static forVehicle(vehicleId: number, companyId: number): VehicleWorkshop {
        const vehicle = vehicleOf(vehicleId, companyId);

        const openRow = stmt(
            `SELECT ${VISIT_COLUMNS} ${VISIT_FROM} WHERE w.vehicle_id = ? AND ${OPEN}`,
        ).get(vehicleId) as VisitRow | undefined;
        const open = openRow ? toVisit(openRow) : null;

        const events = open
            ? (
                  stmt(
                      `
                      SELECT id, action, actor_name, details, created_at
                      FROM workshop_visit_events
                      WHERE visit_id = ?
                      ORDER BY id DESC
                      `,
                  ).all(open.id) as EventRow[]
              ).map(toEvent)
            : [];

        const past = (
            stmt(
                `
                SELECT ${VISIT_COLUMNS} ${VISIT_FROM}
                WHERE w.vehicle_id = ? AND NOT (${OPEN})
                ORDER BY COALESCE(w.finished_on, w.planned_on) DESC, w.id DESC
                LIMIT ?
                `,
            ).all(vehicleId, WORKSHOP_PAST_LIMIT) as VisitRow[]
        ).map(toVisit);

        const here =
            vehicle.at_workshop_id === null
                ? null
                : ((stmt(`SELECT id, name, phone FROM workshops WHERE id = ?`).get(
                      vehicle.at_workshop_id,
                  ) as Pick<WorkshopPlace, "id" | "name" | "phone"> | undefined) ?? null);
        const toPickUp = here
            ? (past.find(
                  (visit) =>
                      visit.state === "DONE" &&
                      visit.workshop_id === Number(here.id) &&
                      visit.picked_up_at === null,
              ) ?? null)
            : null;

        return {
            open,
            events,
            past,
            here: here ? { ...here, id: Number(here.id) } : null,
            to_pick_up: open ? null : toPickUp,
        };
    }

    static create(
        vehicleId: number,
        companyId: number,
        input: WorkshopCreateInput,
        actor: WorkshopActor,
    ): WorkshopVisit {
        const vehicle = vehicleOf(vehicleId, companyId);
        checkAssignee(input.assignee_user_id, companyId);
        const place = workshopOf(input.workshop_id, companyId);
        checkTransport(input.transport, vehicleId, vehicle.license_plate);
        checkBringDriver(input.transport === "DRIVER" ? input.bring_driver_id : null, vehicleId);

        const open = stmt(
            `SELECT 1 FROM workshop_visits w WHERE w.vehicle_id = ? AND ${OPEN}`,
        ).get(vehicleId);
        if (open) {
            throw conflict(
                "WORKSHOP_OPEN",
                `${vehicle.license_plate} hat schon einen offenen Werkstatt-Aufenthalt.`,
            );
        }

        if (input.arrived) {
            refuseDriving(vehicle, "Es lässt sich in die Werkstatt eintragen");
            if (Number(vehicle.at_workshop_id) !== place.id) {
                const message = `${vehicle.license_plate} steht nicht bei ${place.name}. Planen Sie einen Termin; angekommen erkennt fleet-live an der Position.`;
                throw new AppError(409, "NOT_AT_WORKSHOP", message, { workshop_id: message });
            }
        }

        const id = withTransaction(() => {
            const result = stmt(
                `
                INSERT INTO workshop_visits (
                    vehicle_id, reasons, transport, state, place, workshop_id, planned_on,
                    planned_time, expected_on, bring_driver_id, assignee_user_id, note
                )
                VALUES (?, ?, ?, 'PLANNED', ?, ?, ?, ?, ?, ?, ?, ?)
                `,
            ).run(
                vehicleId,
                JSON.stringify(input.reasons),
                input.transport,
                place.name,
                place.id,
                input.planned_on,
                input.planned_time,
                input.expected_on,
                input.transport === "DRIVER" ? input.bring_driver_id : null,
                input.assignee_user_id,
                input.note,
            );
            const visitId = Number(result.lastInsertRowid);
            DamageModel.linkToVisit(vehicleId, visitId, input.damage_ids);

            if (input.arrived) {
                logEvent(visitId, "planned", actor, { planned_on: input.planned_on });
                markArrived(visitId, vehicleId, "POSITION", lastReportAt(vehicleId), actor);
            } else {
                logEvent(visitId, "planned", actor, { planned_on: input.planned_on });
            }

            return visitId;
        });

        // Planned while it already parks there: it has arrived.
        this.detectArrivals();
        return visitOf(id, companyId);
    }

    static update(
        visitId: number,
        companyId: number,
        patch: WorkshopPatch,
        actor: WorkshopActor,
    ): WorkshopVisit {
        const visit = visitOf(visitId, companyId);

        if (visit.state !== "PLANNED" && visit.state !== "IN_WORKSHOP") {
            throw conflict("WORKSHOP_CLOSED", "Der Aufenthalt ist abgeschlossen.");
        }

        const linkedDamages = (
            stmt(
                `SELECT id FROM vehicle_damages WHERE workshop_visit_id = ? AND state = 'OPEN' ORDER BY id`,
            ).all(visitId) as { id: number }[]
        ).map((row) => Number(row.id));
        const current: Record<string, unknown> = { ...visit, damage_ids: linkedDamages };
        const normal = (value: unknown) =>
            JSON.stringify(Array.isArray(value) ? [...value].sort() : value);
        const changed = (key: keyof WorkshopPatch) =>
            patch[key] !== undefined && normal(patch[key]) !== normal(current[key]);

        // What is done there may grow while it is in the workshop; when and
        // where it came, and how, are history by then.
        if (
            visit.state === "IN_WORKSHOP" &&
            (changed("planned_on") ||
                changed("planned_time") ||
                changed("workshop_id") ||
                changed("transport") ||
                changed("bring_driver_id"))
        ) {
            const message = "Termin, Werkstatt und Hinbringen lassen sich nach der Ankunft nicht mehr ändern.";
            throw new ValidationError(message, { planned_on: message });
        }

        if (changed("planned_on") && (patch.planned_on as string) < berlinTodayIso()) {
            throw new ValidationError("Ein Termin liegt heute oder später.", {
                planned_on: "Ein Termin liegt heute oder später.",
            });
        }

        if (patch.assignee_user_id !== undefined) {
            checkAssignee(patch.assignee_user_id, companyId);
        }
        const place =
            patch.workshop_id !== undefined ? workshopOf(patch.workshop_id, companyId) : null;
        const next = {
            ...visit,
            ...patch,
            damage_ids: patch.damage_ids ?? linkedDamages,
            place: place?.name ?? visit.place,
        };
        if (next.transport !== "DRIVER") {
            next.bring_driver_id = null;
        }
        if (changed("transport")) {
            checkTransport(next.transport, visit.vehicle_id, visit.license_plate);
        }
        if (changed("bring_driver_id")) {
            checkBringDriver(next.bring_driver_id, visit.vehicle_id);
        }
        if (next.reasons.includes("DAMAGE") && next.damage_ids.length === 0) {
            const message = "Welcher Schaden? Mindestens einen ankreuzen oder erst melden.";
            throw new ValidationError(message, { damage_ids: message });
        }
        if (!next.reasons.includes("DAMAGE") && next.damage_ids.length > 0) {
            const message = "Mit Schäden gehört „Schaden“ zu dem, was gemacht wird.";
            throw new ValidationError(message, { reasons: message });
        }
        if (next.expected_on && next.expected_on < next.planned_on) {
            throw new ValidationError("Fertig erwartet liegt vor dem Termin.", {
                expected_on: "Fertig erwartet liegt vor dem Termin.",
            });
        }

        const fields = (Object.keys(patch) as (keyof WorkshopPatch)[]).filter(changed);
        if (fields.length === 0) {
            return visit;
        }

        withTransaction(() => {
            stmt(
                `
                UPDATE workshop_visits
                SET reasons = ?, transport = ?, place = ?, workshop_id = ?, planned_on = ?,
                    planned_time = ?, expected_on = ?, bring_driver_id = ?, assignee_user_id = ?,
                    note = ?
                WHERE id = ?
                `,
            ).run(
                JSON.stringify(next.reasons),
                next.transport,
                next.place,
                next.workshop_id,
                next.planned_on,
                next.planned_time,
                next.expected_on,
                next.bring_driver_id,
                next.assignee_user_id,
                next.note,
                visitId,
            );
            if (patch.damage_ids !== undefined) {
                DamageModel.setForVisit(visit.vehicle_id, visitId, patch.damage_ids);
            }
            logEvent(visitId, "updated", actor, { fields });
        });

        this.detectArrivals();
        return visitOf(visitId, companyId);
    }

    /** By hand, when the position cannot tell (no signal, a stay without a workshop place). */
    static arrive(visitId: number, companyId: number, actor: WorkshopActor): WorkshopVisit {
        const visit = visitOf(visitId, companyId);

        if (visit.state !== "PLANNED") {
            throw conflict("WORKSHOP_STATE", "Der Aufenthalt ist nicht mehr geplant.");
        }

        refuseDriving(vehicleOf(visit.vehicle_id, companyId), "Es kommt in die Werkstatt");

        withTransaction(() =>
            markArrived(visitId, visit.vehicle_id, "HAND", nowSqlite(), actor),
        );

        return visitOf(visitId, companyId);
    }

    static finish(
        visitId: number,
        companyId: number,
        body: unknown,
        actor: WorkshopActor,
    ): WorkshopVisit {
        const visit = visitOf(visitId, companyId);

        if (visit.state !== "IN_WORKSHOP") {
            throw conflict(
                "WORKSHOP_STATE",
                "Fertig melden geht erst, wenn das Fahrzeug in der Werkstatt ist.",
            );
        }

        const input = parseWorkshopFinish(
            body,
            visit.reasons,
            visit.arrived_on ?? visit.planned_on,
        );
        const vehicle = vehicleOf(visit.vehicle_id, companyId);

        if (input.odometer_km !== null && OdometerModel.fromDevice(visit.vehicle_id, companyId)) {
            throw new ValidationError("Der Kilometerstand kommt vom Fahrzeug.", {
                odometer: "Der Kilometerstand kommt vom Fahrzeug, wie auf dem Tacho.",
            });
        }

        // Nothing to pick up when it is not standing there (no place, or it left already).
        const stillThere =
            visit.workshop_id !== null && Number(vehicle.at_workshop_id) === visit.workshop_id;

        withTransaction(() => {
            stmt(
                `
                UPDATE workshop_visits
                SET state = 'DONE', finished_on = ?, cost_cents = ?, result_note = ?,
                    picked_up_at = ?
                WHERE id = ?
                `,
            ).run(
                input.finished_on,
                input.cost_cents,
                input.result_note,
                stillThere ? null : nowSqlite(),
                visitId,
            );

            if (visit.reasons.includes("HU") && input.hu_due_on) {
                stmt(`UPDATE vehicles SET hu_due_on = ? WHERE id = ?`).run(
                    input.hu_due_on,
                    visit.vehicle_id,
                );
            }

            DamageModel.repairedByVisit(visitId, input.finished_on);

            // The reading on the invoice sets the counted one right.
            if (input.odometer_km !== null) {
                OdometerModel.set(
                    visit.vehicle_id,
                    companyId,
                    input.odometer_km,
                    "MANUAL",
                    actor,
                    `Werkstattrechnung · ${visit.place}`,
                );
            }

            if (visit.reasons.includes("UVV")) {
                // The next UVV follows from this check and the company interval.
                stmt(
                    `UPDATE vehicles SET uvv_checked_on = ?, uvv_due_on = NULL WHERE id = ?`,
                ).run(input.finished_on, visit.vehicle_id);
            }

            logEvent(visitId, "finished", actor, {
                finished_on: input.finished_on,
                cost_cents: input.cost_cents,
                ...(input.odometer_km !== null ? { odometer_km: input.odometer_km } : {}),
                ...(input.hu_due_on ? { hu_due_on: input.hu_due_on } : {}),
            });
        });

        return visitOf(visitId, companyId);
    }

    /** The invoice came after the stay: its amount. */
    static addCost(
        visitId: number,
        companyId: number,
        costCents: number,
        actor: WorkshopActor,
    ): WorkshopVisit {
        const visit = visitOf(visitId, companyId);

        if (visit.state !== "DONE") {
            throw conflict("WORKSHOP_STATE", "Kosten gehören zu einem fertigen Aufenthalt.");
        }

        withTransaction(() => {
            stmt(`UPDATE workshop_visits SET cost_cents = ? WHERE id = ?`).run(costCents, visitId);
            logEvent(visitId, "cost_added", actor, { cost_cents: costCents });
        });

        return visitOf(visitId, companyId);
    }

    static cancel(visitId: number, companyId: number, actor: WorkshopActor): WorkshopVisit {
        const visit = visitOf(visitId, companyId);

        if (visit.state !== "PLANNED") {
            throw conflict(
                "WORKSHOP_STATE",
                "Absagen geht nur, solange der Aufenthalt geplant ist.",
            );
        }

        withTransaction(() => {
            stmt(`UPDATE workshop_visits SET state = 'CANCELLED' WHERE id = ?`).run(visitId);
            DamageModel.releaseFromVisit(visitId);
            logEvent(visitId, "cancelled", actor);
        });

        return visitOf(visitId, companyId);
    }

    static setOutOfService(vehicleId: number, companyId: number, outOfService: boolean) {
        const vehicle = vehicleOf(vehicleId, companyId);

        if (outOfService) {
            const inWorkshop = stmt(
                `SELECT 1 FROM workshop_visits WHERE vehicle_id = ? AND state = 'IN_WORKSHOP'`,
            ).get(vehicleId);
            if (inWorkshop) {
                throw conflict(
                    "VEHICLE_IN_WORKSHOP",
                    `${vehicle.license_plate} ist in der Werkstatt.`,
                    "out_of_service",
                );
            }

            refuseDriving(vehicle, "Es lässt sich außer Dienst stellen");

            if (vehicle.out_of_service_since === null) {
                withTransaction(() => {
                    stmt(
                        `UPDATE vehicles SET out_of_service_since = CURRENT_TIMESTAMP WHERE id = ?`,
                    ).run(vehicleId);
                    releaseCurrentDriver(vehicleId);
                });
            }
            return;
        }

        stmt(`UPDATE vehicles SET out_of_service_since = NULL WHERE id = ?`).run(vehicleId);
    }

    /**
     * A planned stay whose vehicle stands in the circle of its workshop has
     * arrived, as a real device would show it: position plus standstill.
     * Returns the companies whose vehicles changed.
     */
    static detectArrivals(): number[] {
        const rows = stmt(
            `
            SELECT w.id, w.vehicle_id, v.company_id
            FROM workshop_visits w
            JOIN vehicles v ON v.id = w.vehicle_id
            WHERE w.state = 'PLANNED'
              AND w.workshop_id IS NOT NULL
              AND v.at_workshop_id = w.workshop_id
              AND v.status != 'DRIVING'
            `,
        ).all() as { id: number; vehicle_id: number; company_id: number }[];

        const companies = new Set<number>();
        for (const row of rows) {
            withTransaction(() =>
                markArrived(row.id, row.vehicle_id, "POSITION", lastReportAt(row.vehicle_id), null),
            );
            companies.add(Number(row.company_id));
        }
        return [...companies];
    }

    /**
     * What workshop stays need from someone today (`WORKSHOP_TASK_SQL`), one
     * row per vehicle. Stays assigned to `userId` come first, then the task
     * order of `WORKSHOP_TASKS`, oldest first.
     */
    static tasksForCompany(companyId: number, userId: number | null): WorkshopTaskRow[] {
        const rows = stmt(
            `
            SELECT * FROM (
                SELECT v.id AS vehicle_id, v.license_plate, v.at_workshop_id,
                    ${WORKSHOP_TASK_SQL} AS task,
                    (SELECT substr(t.recorded_at, 1, 19) FROM telemetry t WHERE t.id = v.last_telemetry_id) AS last_report
                FROM vehicles v
                WHERE v.company_id = ?
            )
            WHERE task IS NOT NULL
            `,
        ).all(companyId) as {
            vehicle_id: number;
            license_plate: string;
            at_workshop_id: number | null;
            task: WorkshopTask;
            last_report: string | null;
        }[];

        const tasks = rows.map((row): WorkshopTaskRow => {
            const visitRow =
                row.task === "pickup"
                    ? (stmt(
                          `
                          SELECT ${VISIT_COLUMNS} ${VISIT_FROM}
                          WHERE w.vehicle_id = ? AND w.state = 'DONE' AND w.workshop_id = ?
                            AND w.picked_up_at IS NULL
                          ORDER BY w.id DESC LIMIT 1
                          `,
                      ).get(row.vehicle_id, row.at_workshop_id) as VisitRow | undefined)
                    : row.task === "unplanned"
                      ? undefined
                      : (stmt(
                            `SELECT ${VISIT_COLUMNS} ${VISIT_FROM} WHERE w.vehicle_id = ? AND ${OPEN}`,
                        ).get(row.vehicle_id) as VisitRow | undefined);
            const visit = visitRow ? toVisit(visitRow) : null;
            const placeId = visit?.workshop_id ?? row.at_workshop_id;
            const place =
                placeId === null
                    ? null
                    : (stmt(`SELECT id, name, phone FROM workshops WHERE id = ?`).get(placeId) as
                          | Pick<WorkshopPlace, "id" | "name" | "phone">
                          | undefined) ?? null;

            return {
                vehicle_id: Number(row.vehicle_id),
                license_plate: row.license_plate,
                task: row.task,
                visit,
                place: place ? { ...place, id: Number(place.id) } : null,
                since:
                    row.task === "unplanned" || row.task === "pickup" ? row.last_report : null,
            };
        });

        // Missed appointments first, oldest first; within a task the stays
        // assigned to the asking dispatcher come first.
        const order = (task: WorkshopTask) => WORKSHOP_TASKS.indexOf(task);
        return tasks.sort(
            (left, right) =>
                order(left.task) - order(right.task) ||
                Number(right.visit?.assignee_user_id === userId && userId !== null) -
                    Number(left.visit?.assignee_user_id === userId && userId !== null) ||
                (left.visit?.expected_on ?? left.visit?.planned_on ?? "").localeCompare(
                    right.visit?.expected_on ?? right.visit?.planned_on ?? "",
                ) ||
                left.vehicle_id - right.vehicle_id,
        );
    }

    /**
     * For the simulator: today's planned stays at a workshop place (drive
     * there), and finished stays whose vehicle stands there with a driver
     * (drive off). Pure data; the simulator decides what to play.
     */
    static simTargets(): WorkshopSimTarget[] {
        return (
            stmt(
                `
                SELECT v.id AS vehicle_id, v.company_id, 'to_workshop' AS kind,
                    w.transport,
                    v.status = 'DRIVING' AS driving,
                    v.current_driver_id IS NOT NULL AS has_driver,
                    v.at_workshop_id IS w.workshop_id AS there,
                    w.planned_time, ws.latitude, ws.longitude
                FROM workshop_visits w
                JOIN vehicles v ON v.id = w.vehicle_id
                JOIN workshops ws ON ws.id = w.workshop_id
                WHERE w.state = 'PLANNED' AND w.planned_on = berlin_today()
                UNION ALL
                SELECT v.id, v.company_id, 'pickup', 'DRIVER', 0, 1, 1, NULL, NULL, NULL
                FROM vehicles v
                WHERE v.status NOT IN ('DRIVING', 'OFFLINE')
                  AND v.current_driver_id IS NOT NULL
                  AND v.at_workshop_id IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM workshop_visits w
                      WHERE w.vehicle_id = v.id AND w.state = 'DONE'
                        AND w.workshop_id = v.at_workshop_id AND w.picked_up_at IS NULL
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM workshop_visits w
                      WHERE w.vehicle_id = v.id AND ${OPEN}
                  )
                `,
            ).all() as (Omit<WorkshopSimTarget, "driving" | "has_driver" | "there"> & {
                driving: number;
                has_driver: number;
                there: number;
            })[]
        ).map((row) => ({
            ...row,
            vehicle_id: Number(row.vehicle_id),
            company_id: Number(row.company_id),
            driving: Boolean(row.driving),
            has_driver: Boolean(row.has_driver),
            there: Boolean(row.there),
        }));
    }

    /**
     * Who may bring the vehicle on day `on`: its released drivers, with an
     * expired licence, another drive right now and other workshop trips that
     * day spelled out, so the dialog can say it before anyone clicks.
     */
    static bringers(vehicleId: number, companyId: number, on: string): WorkshopBringer[] {
        vehicleOf(vehicleId, companyId);
        const today = berlinTodayIso();
        const drivers = stmt(
            `
            SELECT d.id, d.name, d.licence_expires_on,
                (SELECT current_driver_id FROM vehicles WHERE id = ?) = d.id AS is_current,
                (
                    SELECT v.license_plate FROM vehicles v
                    WHERE v.current_driver_id = d.id AND v.status = 'DRIVING' AND v.id != ?
                ) AS driving_plate
            FROM driver_vehicles dv
            JOIN drivers d ON d.id = dv.driver_id
            WHERE dv.vehicle_id = ? AND d.company_id = ?
            ORDER BY d.name
            `,
        ).all(vehicleId, vehicleId, vehicleId, companyId) as {
            id: number;
            name: string;
            licence_expires_on: string | null;
            is_current: number;
            driving_plate: string | null;
        }[];
        const trips = stmt(
            `
            SELECT w.id AS visit_id, w.bring_driver_id, v.license_plate, w.place
            FROM workshop_visits w
            JOIN vehicles v ON v.id = w.vehicle_id
            WHERE v.company_id = ? AND w.state = 'PLANNED' AND w.planned_on = ?
              AND w.vehicle_id != ? AND w.bring_driver_id IS NOT NULL
            `,
        ).all(companyId, on, vehicleId) as {
            visit_id: number;
            bring_driver_id: number;
            license_plate: string;
            place: string;
        }[];

        return drivers.map((driver) => ({
            id: Number(driver.id),
            name: driver.name,
            licence_expires_on: driver.licence_expires_on,
            licence_expired: isLicenceExpired(driver.licence_expires_on, today),
            is_current: Boolean(driver.is_current),
            driving_plate: driver.driving_plate,
            other_transports: trips
                .filter((trip) => Number(trip.bring_driver_id) === Number(driver.id))
                .map((trip) => ({
                    visit_id: Number(trip.visit_id),
                    license_plate: trip.license_plate,
                    place: trip.place,
                })),
        }));
    }

    /** Open stays of the company by vehicle, for the HU/UVV rows of `/fristen`. */
    static openByVehicle(companyId: number): Map<number, WorkshopSummary> {
        const rows = stmt(
            `
            SELECT w.id, w.vehicle_id, w.state, w.reasons, w.place, w.workshop_id,
                w.planned_on, w.planned_time, w.expected_on
            FROM workshop_visits w
            JOIN vehicles v ON v.id = w.vehicle_id
            WHERE v.company_id = ? AND ${OPEN}
            `,
        ).all(companyId) as (Omit<WorkshopSummary, "reasons"> & {
            vehicle_id: number;
            reasons: string;
        })[];

        return new Map(
            rows.map(({ vehicle_id, ...summary }) => [
                Number(vehicle_id),
                {
                    ...summary,
                    reasons: parseReasons(summary.reasons),
                    id: Number(summary.id),
                    workshop_id: summary.workshop_id === null ? null : Number(summary.workshop_id),
                },
            ]),
        );
    }

    /** Why a vehicle cannot get a driver now, or `null`. */
    static unavailableReason(vehicleId: number): string | null {
        const row = stmt(
            `
            SELECT v.license_plate, ${VEHICLE_AVAILABILITY_SQL} AS availability
            FROM vehicles v
            WHERE v.id = ?
            `,
        ).get(vehicleId) as { license_plate: string; availability: string } | undefined;

        const why: Record<string, string> = {
            WORKSHOP: "ist in der Werkstatt",
            NOT_DRIVABLE: "ist nicht fahrbereit",
            OUT_OF_SERVICE: "ist außer Dienst",
        };

        return row && why[row.availability]
            ? `${row.license_plate} ${why[row.availability]} und lässt sich keinem Fahrer zuweisen.`
            : null;
    }
}
