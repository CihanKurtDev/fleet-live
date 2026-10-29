import type { Request, Response } from "express";
import { sessionCompany } from "../lib/http";
import { NotFoundError } from "../lib/errors";
import { AuditModel } from "../models/audit.model";
import { driverExport } from "../models/driverExport.model";
import { ExportModel } from "../models/export.model";

const FILES = {
    vehicles: "fahrzeuge.csv",
    alerts: "warnungen.csv",
    trips: "fahrten.csv",
    period: "zeitraum.csv",
} as const;

function sendCsv(res: Response, filename: string, body: string) {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(body);
}

export function exportVehicles(req: Request, res: Response) {
    sendCsv(
        res,
        FILES.vehicles,
        ExportModel.vehiclesCsv(sessionCompany(req)),
    );
}

export function exportAlerts(req: Request, res: Response) {
    sendCsv(res, FILES.alerts, ExportModel.alertsCsv(sessionCompany(req)));
}

export function exportTrips(req: Request, res: Response) {
    sendCsv(res, FILES.trips, ExportModel.tripsCsv(sessionCompany(req)));
}

/** A safe file name from a person's name: letters, digits, dashes. */
function fileStem(name: string): string {
    const stem = name
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/ß/g, "ss")
        .replace(/[^A-Za-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();

    return stem || "fahrer";
}

/** Everything about one driver as a zip; who exported it goes into the log. */
export function exportDriver(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const driverId = Number(req.params.id);
    const result = Number.isInteger(driverId) ? driverExport(companyId, driverId) : undefined;

    if (!result) {
        throw new NotFoundError("Fahrer nicht gefunden.");
    }

    AuditModel.record({
        companyId,
        action: "driver_exported",
        actorId: req.user?.id ?? null,
        details: { driver: result.name },
    });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
        "Content-Disposition",
        `attachment; filename="auskunft-${fileStem(result.name)}.zip"`,
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.send(Buffer.from(result.zip));
}

export function exportPeriod(req: Request, res: Response) {
    sendCsv(
        res,
        FILES.period,
        ExportModel.periodCsv(sessionCompany(req), req.query.month),
    );
}
