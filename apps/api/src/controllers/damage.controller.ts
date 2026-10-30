import type { Request, Response } from "express";
import { parseDamageInput, parseDamagePatch } from "@fleet-live/shared";

import { UnauthorizedError } from "../lib/errors";
import { notifyVehiclesChanged, parseId, sessionCompany } from "../lib/http";
import { DamageModel } from "../models/damage.model";

export function getVehicleDamages(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const vehicleId = parseId(req.params.id, "Fahrzeug-ID");
    res.json({ data: DamageModel.forVehicle(vehicleId, companyId) });
}

export function createVehicleDamage(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const vehicleId = parseId(req.params.id, "Fahrzeug-ID");

    if (!req.user) {
        throw new UnauthorizedError();
    }

    const damage = DamageModel.create(vehicleId, companyId, parseDamageInput(req.body), {
        id: req.user.id,
        name: req.user.name,
    });
    notifyVehiclesChanged(companyId);
    res.status(201).json({ data: damage });
}

export function patchDamage(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const damageId = parseId(req.params.damageId, "Schaden-ID");
    const damage = DamageModel.update(damageId, companyId, parseDamagePatch(req.body));
    notifyVehiclesChanged(companyId);
    res.json({ data: damage });
}

export function closeDamage(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const damageId = parseId(req.params.damageId, "Schaden-ID");
    const damage = DamageModel.close(damageId, companyId);
    notifyVehiclesChanged(companyId);
    res.json({ data: damage });
}
