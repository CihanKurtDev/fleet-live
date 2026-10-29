import type { Request, Response } from "express";
import { parseRetentionPatch, type AuditDetails } from "@fleet-live/shared";
import { db } from "../db/database";
import { pruneResolvedAlerts } from "../db/alertRetention";
import { pruneAuditEvents } from "../db/auditRetention";
import { UnauthorizedError } from "../lib/errors";
import { AuditModel } from "../models/audit.model";
import { RetentionModel } from "../models/retention.model";
import { TripModel } from "../models/trip.model";

export function getRetention(req: Request, res: Response) {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    res.json({ data: RetentionModel.get(req.user.company_id) });
}

/** Rows of this company that retention can delete. */
function counts(companyId: number) {
    const one = (sql: string) => (db.prepare(sql).get(companyId) as { n: number }).n;

    return {
        trips: one(
            "SELECT COUNT(*) AS n FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE v.company_id = ? AND t.ended_at IS NOT NULL",
        ),
        alerts: one(
            "SELECT COUNT(*) AS n FROM alerts a JOIN vehicles v ON v.id = a.vehicle_id WHERE v.company_id = ? AND a.resolved_at IS NOT NULL",
        ),
        audit: one("SELECT COUNT(*) AS n FROM audit_events WHERE company_id = ?"),
    };
}

/** Saves the company's retention, deletes what is now past it at once and says how much. */
export function patchRetention(req: Request, res: Response) {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    const companyId = req.user.company_id;
    const patch = parseRetentionPatch(req.body);
    const before = RetentionModel.get(companyId);
    RetentionModel.update(companyId, patch);
    const after = RetentionModel.get(companyId);

    const retention: NonNullable<AuditDetails["retention"]> = {};

    if (before.trips_days !== after.trips_days) retention.trips = after.trips_days;
    if (before.alerts_days !== after.alerts_days) retention.alerts = after.alerts_days;
    if (before.audit_days !== after.audit_days) retention.audit = after.audit_days;

    let deleted = { trips: 0, alerts: 0, audit: 0 };

    if (Object.keys(retention).length > 0) {
        AuditModel.record({
            companyId,
            action: "retention_changed",
            actorId: req.user.id,
            details: { retention },
        });
        const before = counts(companyId);
        TripModel.pruneClosedForCompany(companyId);
        pruneResolvedAlerts(db);
        pruneAuditEvents(db);
        const left = counts(companyId);
        deleted = {
            trips: before.trips - left.trips,
            alerts: before.alerts - left.alerts,
            audit: before.audit - left.audit,
        };
    }

    res.json({ data: after, deleted });
}
