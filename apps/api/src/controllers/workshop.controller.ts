import type { Request, Response } from "express";
import {
    berlinTodayIso,
    parseVehicleAvailabilityPatch,
    parseGeocodeQuery,
    parseWorkshopCreate,
    parseWorkshopCostPatch,
    parseWorkshopPatch,
    parseWorkshopPlaceInput,
    parseWorkshopPlacePatch,
} from "@fleet-live/shared";

import { NotFoundError, UnauthorizedError } from "../lib/errors";
import { geocode, geocoderEnabled } from "../lib/geocoder";
import { notifyVehiclesChanged, parseId, sessionCompany } from "../lib/http";
import { VehicleModel } from "../models/vehicle.model";
import { WorkshopModel, type WorkshopActor } from "../models/workshop.model";
import { WorkshopPlaceModel } from "../models/workshopPlace.model";

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

/** `?on=YYYY-MM-DD`: who may bring it on that day (default today). */
export function getVehicleWorkshopBringers(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const vehicleId = parseId(req.params.id, "Fahrzeug-ID");
    const on =
        typeof req.query.on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.on)
            ? req.query.on
            : berlinTodayIso();
    res.json({ data: WorkshopModel.bringers(vehicleId, companyId, on) });
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
    res.json({ data: WorkshopPlaceModel.list(sessionCompany(req)) });
}

export function createWorkshopPlace(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const place = WorkshopPlaceModel.create(companyId, parseWorkshopPlaceInput(req.body));
    // A vehicle may already stand in the new circle with a stay planned there.
    WorkshopModel.detectArrivals();
    notifyVehiclesChanged(companyId);
    res.status(201).json({ data: place });
}

export function patchWorkshopPlace(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const placeId = parseId(req.params.placeId, "Werkstatt-ID");
    const place = WorkshopPlaceModel.update(placeId, companyId, parseWorkshopPlacePatch(req.body));
    WorkshopModel.detectArrivals();
    notifyVehiclesChanged(companyId);
    res.json({ data: place });
}

export function deleteWorkshopPlace(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    WorkshopPlaceModel.delete(parseId(req.params.placeId, "Werkstatt-ID"), companyId);
    notifyVehiclesChanged(companyId);
    res.status(204).end();
}

export function addWorkshopCost(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const visitId = parseId(req.params.visitId, "Aufenthalts-ID");
    const { cost_cents } = parseWorkshopCostPatch(req.body);
    const visit = WorkshopModel.addCost(visitId, companyId, cost_cents, actor(req));
    notifyVehiclesChanged(companyId);
    res.json({ data: visit });
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

export function getGeocodeConfig(_req: Request, res: Response) {
    res.json({ data: { enabled: geocoderEnabled() } });
}

export async function searchAddress(req: Request, res: Response) {
    const query = parseGeocodeQuery(req.query);
    res.json({ data: await geocode(query) });
}
