import type { Request, Response } from "express";
import { parseAlertListQuery, parseAlertPatch } from "@fleet-live/shared";
import { AlertModel } from "../models/alert.model";
import { DriverModel } from "../models/driver.model";
import { VehicleModel } from "../models/vehicle.model";
import { NotFoundError } from "../lib/errors";
import { notifyVehiclesChanged, parseId, sessionCompany } from "../lib/http";

function parseAlertId(value: string | string[] | undefined): number {
    return parseId(value, "Warnungs-ID");
}

export function getAlerts(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const query = parseAlertListQuery(req.query);

    if (
        query.vehicle_id !== undefined &&
        !VehicleModel.getById(query.vehicle_id, companyId)
    ) {
        throw new NotFoundError();
    }

    if (
        query.driver_id !== undefined &&
        !DriverModel.getById(query.driver_id, companyId)
    ) {
        throw new NotFoundError();
    }

    const started = performance.now();
    const result = AlertModel.listForCompany(companyId, query);
    const duration = performance.now() - started;

    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.setHeader("Server-Timing", `db;dur=${duration.toFixed(1)}`);
    res.json(result);
}

export function resolveAlert(req: Request, res: Response) {
    parseAlertPatch(req.body);

    const companyId = sessionCompany(req);
    const id = parseAlertId(req.params.id);
    const current = AlertModel.getById(id, companyId);

    if (!current) {
        throw new NotFoundError("Warnung nicht gefunden.");
    }

    const alert = AlertModel.resolve(id, companyId);

    if (!alert) {
        throw new NotFoundError("Warnung nicht gefunden.");
    }

    if (current.resolved_at === null) {
        notifyVehiclesChanged(companyId);
    }

    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.json(alert);
}
