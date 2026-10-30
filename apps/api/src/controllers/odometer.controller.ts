import type { Request, Response } from "express";
import { parseOdometerCorrection } from "@fleet-live/shared";

import { UnauthorizedError, ValidationError } from "../lib/errors";
import { notifyVehiclesChanged, parseId, sessionCompany } from "../lib/http";
import { OdometerModel } from "../models/odometer.model";

export function getVehicleOdometer(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const vehicleId = parseId(req.params.id, "Fahrzeug-ID");
    res.json({ data: OdometerModel.forVehicle(vehicleId, companyId) });
}

export function correctVehicleOdometer(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const vehicleId = parseId(req.params.id, "Fahrzeug-ID");

    if (!req.user) {
        throw new UnauthorizedError();
    }

    const input = parseOdometerCorrection(req.body);
    const changed = OdometerModel.set(
        vehicleId,
        companyId,
        input.km,
        "MANUAL",
        { id: req.user.id, name: req.user.name },
        input.note,
    );

    if (!changed) {
        throw new ValidationError("Das ist schon der aktuelle Stand.", {
            km: "Das ist schon der aktuelle Stand.",
        });
    }

    notifyVehiclesChanged(companyId);
    res.json({ data: OdometerModel.forVehicle(vehicleId, companyId) });
}
