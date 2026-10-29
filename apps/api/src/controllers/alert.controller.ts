import type { Request, Response } from "express";
import {
    parseAlertBulkPatch,
    parseAlertListQuery,
    parseAlertPatch,
    type AlertBulkPatchResponse,
} from "@fleet-live/shared";
import { AlertModel } from "../models/alert.model";
import { DriverModel } from "../models/driver.model";
import { VehicleModel } from "../models/vehicle.model";
import { DRIVER_NAMES_HIDDEN, hidesDriverNames, withoutDriver } from "../lib/driverNames";
import { AppError, NotFoundError } from "../lib/errors";
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

    const hidden = hidesDriverNames(req);

    if (hidden && query.driver_id !== undefined) {
        throw new AppError(403, "DRIVER_NAMES_HIDDEN", DRIVER_NAMES_HIDDEN);
    }

    const started = performance.now();
    const listed = AlertModel.listForCompany(companyId, query);
    const result = hidden ? { ...listed, data: listed.data.map(withoutDriver) } : listed;
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

export function resolveAlerts(req: Request, res: Response) {
    const { ids } = parseAlertBulkPatch(req.body);
    const companyId = sessionCompany(req);
    const result = AlertModel.resolveMany(ids, companyId);

    if (!result) {
        throw new NotFoundError("Mindestens eine Warnung wurde nicht gefunden.");
    }

    if (result.resolved > 0) {
        notifyVehiclesChanged(companyId);
    }

    const body: AlertBulkPatchResponse = { data: result };
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.json(body);
}
