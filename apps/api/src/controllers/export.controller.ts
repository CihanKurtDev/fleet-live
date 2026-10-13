import type { Request, Response } from "express";
import { sessionCompany } from "../lib/http";
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

export function exportPeriod(req: Request, res: Response) {
    sendCsv(
        res,
        FILES.period,
        ExportModel.periodCsv(sessionCompany(req), req.query.month),
    );
}
