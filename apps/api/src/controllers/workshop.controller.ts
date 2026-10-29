import type { Request, Response } from "express";
import {
    parseVehicleAvailabilityPatch,
    parseWorkshopCreate,
    parseWorkshopPatch,
} from "@fleet-live/shared";

import { NotFoundError, UnauthorizedError } from "../lib/errors";
import { notifyVehiclesChanged, parseId, sessionCompany } from "../lib/http";
import { VehicleModel } from "../models/vehicle.model";
import { WorkshopModel, type WorkshopActor } from "../models/workshop.model";

function actor(req: Request): WorkshopActor {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    return { id: req.user.id, name: req.user.name };
}

export function getVehicleWorkshop(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const vehicleId = parseId(req.params.id, "Fahrzeug-ID");
    res.json({ data: WorkshopModel.forVehicle(vehicleId, companyId) });
}

export function createVehicleWorkshop(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const vehicleId = parseId(req.params.id, "Fahrzeug-ID");
    const visit = WorkshopModel.create(
        vehicleId,
        companyId,
        parseWorkshopCreate(req.body),
        actor(req),
    );
    notifyVehiclesChanged(companyId);
    res.status(201).json({ data: visit });
}

export function patchVehicleAvailability(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const vehicleId = parseId(req.params.id, "Fahrzeug-ID");
    const { out_of_service } = parseVehicleAvailabilityPatch(req.body);
    WorkshopModel.setOutOfService(vehicleId, companyId, out_of_service);

    const vehicle = VehicleModel.getById(vehicleId, companyId);
    if (!vehicle) {
        throw new NotFoundError();
    }

    notifyVehiclesChanged(companyId);
    res.json({ data: vehicle });
}

export function getWorkshopPlaces(req: Request, res: Response) {
    res.json({ data: WorkshopModel.places(sessionCompany(req)) });
}

export function patchWorkshopVisit(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const visitId = parseId(req.params.visitId, "Aufenthalts-ID");
    const visit = WorkshopModel.update(
        visitId,
        companyId,
        parseWorkshopPatch(req.body),
        actor(req),
    );
    notifyVehiclesChanged(companyId);
    res.json({ data: visit });
}

export function arriveWorkshopVisit(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const visitId = parseId(req.params.visitId, "Aufenthalts-ID");
    const visit = WorkshopModel.arrive(visitId, companyId, actor(req));
    notifyVehiclesChanged(companyId);
    res.json({ data: visit });
}

export function finishWorkshopVisit(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const visitId = parseId(req.params.visitId, "Aufenthalts-ID");
    const visit = WorkshopModel.finish(visitId, companyId, req.body, actor(req));
    notifyVehiclesChanged(companyId);
    res.json({ data: visit });
}

export function cancelWorkshopVisit(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const visitId = parseId(req.params.visitId, "Aufenthalts-ID");
    const visit = WorkshopModel.cancel(visitId, companyId, actor(req));
    notifyVehiclesChanged(companyId);
    res.json({ data: visit });
}
