import {
    WORKSHOP_PAST_LIMIT,
    berlinTodayIso,
    parseWorkshopFinish,
    type VehicleWorkshop,
    type WorkshopCreateInput,
    type WorkshopEvent,
    type WorkshopEventAction,
    type WorkshopPatch,
    type WorkshopSummary,
    type WorkshopVisit,
} from "@fleet-live/shared";

import { withTransaction } from "../db/database";
import { stmt } from "../db/statements";
import { VEHICLE_AVAILABILITY_SQL, WORKSHOP_DUE_SQL } from "../db/vehicleConcepts";
import { DamageModel } from "./damage.model";
import { AppError, NotFoundError, ValidationError } from "../lib/errors";

export type WorkshopActor = { id: number; name: string };

type VisitRow = Omit<WorkshopVisit, "cost_cents"> & { cost_cents: number | null };

type EventRow = Omit<WorkshopEvent, "details"> & { details: string | null };

type VehicleRow = {
    id: number;
    license_plate: string;
    status: string;
    out_of_service_since: string | null;
};

const VISIT_COLUMNS = `
    w.id,
    w.vehicle_id,
    v.license_plate,
    v.hu_due_on,
    w.reason,
    w.state,
    w.place,
    w.planned_on,
    w.expected_on,
    w.assignee_user_id,
    u.name AS assignee_name,
    w.note,
    w.arrived_on,
    w.finished_on,
    w.cost_cents,
    w.result_note,
    w.created_at
`;

const VISIT_FROM = `
    FROM workshop_visits w
    JOIN vehicles v ON v.id = w.vehicle_id
    LEFT JOIN users u ON u.id = w.assignee_user_id
`;

const OPEN = `w.state IN ('PLANNED', 'IN_WORKSHOP')`;

function toVisit(row: VisitRow): WorkshopVisit {
    return {
        ...row,
        id: Number(row.id),
        vehicle_id: Number(row.vehicle_id),
        assignee_user_id:
            row.assignee_user_id === null ? null : Number(row.assignee_user_id),
        cost_cents: row.cost_cents === null ? null : Number(row.cost_cents),
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
        SELECT id, license_plate, status, out_of_service_since
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

function logEvent(
    visitId: number,
    action: WorkshopEventAction,
    actor: WorkshopActor,
    details: WorkshopEvent["details"] = null,
) {
    stmt(
        `
        INSERT INTO workshop_visit_events (visit_id, action, actor_user_id, actor_name, details)
        VALUES (?, ?, ?, ?, ?)
        `,
    ).run(visitId, action, actor.id, actor.name, details ? JSON.stringify(details) : null);
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

export class WorkshopModel {
    static forVehicle(vehicleId: number, companyId: number): VehicleWorkshop {
        vehicleOf(vehicleId, companyId);

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

        return { open, events, past };
    }

    static create(
        vehicleId: number,
        companyId: number,
        input: WorkshopCreateInput,
        actor: WorkshopActor,
    ): WorkshopVisit {
        const vehicle = vehicleOf(vehicleId, companyId);
        checkAssignee(input.assignee_user_id, companyId);

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
        }

        const id = withTransaction(() => {
            const result = stmt(
                `
                INSERT INTO workshop_visits (
                    vehicle_id, reason, state, place, planned_on, expected_on,
                    assignee_user_id, note, arrived_on
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
            ).run(
                vehicleId,
                input.reason,
                input.arrived ? "IN_WORKSHOP" : "PLANNED",
                input.place,
                input.planned_on,
                input.expected_on,
                input.assignee_user_id,
                input.note,
                input.arrived ? input.planned_on : null,
            );
            const visitId = Number(result.lastInsertRowid);
            DamageModel.linkToVisit(vehicleId, visitId, input.damage_ids);

            if (input.arrived) {
                releaseCurrentDriver(vehicleId);
                stmt(`UPDATE vehicles SET out_of_service_since = NULL WHERE id = ?`).run(
                    vehicleId,
                );
                logEvent(visitId, "arrived", actor);
            } else {
                logEvent(visitId, "planned", actor, { planned_on: input.planned_on });
            }

            return visitId;
        });

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

        if (
            visit.state === "IN_WORKSHOP" &&
            ((patch.planned_on !== undefined && patch.planned_on !== visit.planned_on) ||
                (patch.reason !== undefined && patch.reason !== visit.reason))
        ) {
            const message = "Termin und Grund lassen sich nach der Ankunft nicht mehr ändern.";
            throw new ValidationError(message, {
                [patch.reason !== undefined ? "reason" : "planned_on"]: message,
            });
        }

        if (patch.assignee_user_id !== undefined) {
            checkAssignee(patch.assignee_user_id, companyId);
        }

        const next = { ...visit, ...patch };
        if (next.expected_on && next.expected_on < next.planned_on) {
            throw new ValidationError("Fertig erwartet am liegt vor dem Termin.", {
                expected_on: "Fertig erwartet am liegt vor dem Termin.",
            });
        }

        const fields = (Object.keys(patch) as (keyof WorkshopPatch)[]).filter(
            (key) => patch[key] !== visit[key],
        );
        if (fields.length === 0) {
            return visit;
        }

        withTransaction(() => {
            stmt(
                `
                UPDATE workshop_visits
                SET reason = ?, place = ?, planned_on = ?, expected_on = ?,
                    assignee_user_id = ?, note = ?
                WHERE id = ?
                `,
            ).run(
                next.reason,
                next.place,
                next.planned_on,
                next.expected_on,
                next.assignee_user_id,
                next.note,
                visitId,
            );
            logEvent(visitId, "updated", actor, { fields });
        });

        return visitOf(visitId, companyId);
    }

    static arrive(visitId: number, companyId: number, actor: WorkshopActor): WorkshopVisit {
        const visit = visitOf(visitId, companyId);

        if (visit.state !== "PLANNED") {
            throw conflict("WORKSHOP_STATE", "Der Aufenthalt ist nicht mehr geplant.");
        }

        refuseDriving(vehicleOf(visit.vehicle_id, companyId), "Es kommt in die Werkstatt");

        withTransaction(() => {
            stmt(
                `UPDATE workshop_visits SET state = 'IN_WORKSHOP', arrived_on = ? WHERE id = ?`,
            ).run(berlinTodayIso(), visitId);
            releaseCurrentDriver(visit.vehicle_id);
            stmt(`UPDATE vehicles SET out_of_service_since = NULL WHERE id = ?`).run(
                visit.vehicle_id,
            );
            logEvent(visitId, "arrived", actor);
        });

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
            visit.reason,
            visit.arrived_on ?? visit.planned_on,
        );

        withTransaction(() => {
            stmt(
                `
                UPDATE workshop_visits
                SET state = 'DONE', finished_on = ?, cost_cents = ?, result_note = ?
                WHERE id = ?
                `,
            ).run(input.finished_on, input.cost_cents, input.result_note, visitId);

            if (visit.reason === "HU" && input.hu_due_on) {
                stmt(`UPDATE vehicles SET hu_due_on = ? WHERE id = ?`).run(
                    input.hu_due_on,
                    visit.vehicle_id,
                );
            }

            DamageModel.repairedByVisit(visitId, input.finished_on);

            if (visit.reason === "UVV") {
                // The next UVV follows from this check and the company interval.
                stmt(
                    `UPDATE vehicles SET uvv_checked_on = ?, uvv_due_on = NULL WHERE id = ?`,
                ).run(input.finished_on, visit.vehicle_id);
            }

            logEvent(visitId, "finished", actor, {
                finished_on: input.finished_on,
                cost_cents: input.cost_cents,
                ...(input.hu_due_on ? { hu_due_on: input.hu_due_on } : {}),
            });
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

    /** Places used before in this company, most recent first. */
    static places(companyId: number): string[] {
        return (
            stmt(
                `
                SELECT w.place, MAX(w.id) AS last_id
                FROM workshop_visits w
                JOIN vehicles v ON v.id = w.vehicle_id
                WHERE v.company_id = ?
                GROUP BY w.place COLLATE NOCASE
                ORDER BY last_id DESC
                LIMIT 30
                `,
            ).all(companyId) as { place: string }[]
        ).map((row) => row.place);
    }

    /**
     * Stays that need someone today (`WORKSHOP_DUE_SQL`), the ones assigned to
     * `userId` first, late returns before appointments, oldest first.
     */
    static dueForCompany(companyId: number, userId: number | null): WorkshopVisit[] {
        return (
            stmt(
                `
                SELECT ${VISIT_COLUMNS} ${VISIT_FROM}
                WHERE v.company_id = ? AND ${WORKSHOP_DUE_SQL}
                ORDER BY
                    (w.assignee_user_id IS NOT NULL AND w.assignee_user_id = ?) DESC,
                    w.state = 'IN_WORKSHOP' DESC,
                    COALESCE(w.expected_on, w.planned_on),
                    w.id
                `,
            ).all(companyId, userId) as VisitRow[]
        ).map(toVisit);
    }

    /** Open stays of the company by vehicle, for the HU/UVV rows of `/fristen`. */
    static openByVehicle(companyId: number): Map<number, WorkshopSummary> {
        const rows = stmt(
            `
            SELECT w.id, w.vehicle_id, w.state, w.reason, w.place, w.planned_on, w.expected_on
            FROM workshop_visits w
            JOIN vehicles v ON v.id = w.vehicle_id
            WHERE v.company_id = ? AND ${OPEN}
            `,
        ).all(companyId) as (WorkshopSummary & { vehicle_id: number })[];

        return new Map(
            rows.map(({ vehicle_id, ...summary }) => [
                Number(vehicle_id),
                { ...summary, id: Number(summary.id) },
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
