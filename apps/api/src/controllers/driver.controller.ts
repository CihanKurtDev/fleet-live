import type { Request, Response } from "express";
import {
    parseDriverCreate,
    parseDriverCurrentVehicle,
    parseDriverListQuery,
    parseDriverVehicleAssign,
} from "@fleet-live/shared";
import { DriverModel } from "../models/driver.model";
import { VehicleModel } from "../models/vehicle.model";
import {
    BadRequestError,
    NotFoundError,
    UnauthorizedError,
} from "../lib/errors";
import { broadcast } from "../sse/hub";

function parseId(value: string | string[] | undefined, label: string): number {
    if (typeof value !== "string") {
        throw new BadRequestError(`Ungültige ${label}.`);
    }

    const id = Number(value);
    if (!Number.isInteger(id) || id < 1) {
        throw new BadRequestError(`Ungültige ${label}.`);
    }

    return id;
}

function sessionCompany(req: Request): number {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    return req.user.company_id;
}

function notifyVehiclesChanged(companyId: number) {
    broadcast("vehicles-changed", { at: Date.now() }, companyId);
}

export function getDrivers(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const query = parseDriverListQuery(req.query);

    if (
        query.vehicle_id !== undefined &&
        !VehicleModel.getById(query.vehicle_id, companyId)
    ) {
        throw new NotFoundError("Fahrzeug nicht gefunden.");
    }

    const started = performance.now();
    const result = DriverModel.list(query, companyId);
    const duration = performance.now() - started;

    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.setHeader("Server-Timing", `db;dur=${duration.toFixed(1)}`);
    res.json(result);
}

export function getDriverById(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const id = parseId(req.params.id, "Fahrer-ID");
    const driver = DriverModel.getDetail(id, companyId);

    if (!driver) {
        throw new NotFoundError("Fahrer nicht gefunden.");
    }

    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.json({ data: driver });
}

export function createDriver(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const input = parseDriverCreate(req.body);
    const driver = DriverModel.create(companyId, input.name);

    notifyVehiclesChanged(companyId);
    res.status(201).location(`/api/drivers/${driver.id}`).json({ data: driver });
}

export function assignDriverVehicle(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const driverId = parseId(req.params.id, "Fahrer-ID");
    const { vehicle_id } = parseDriverVehicleAssign(req.body);
    const driver = DriverModel.assignVehicle(driverId, vehicle_id, companyId);

    notifyVehiclesChanged(companyId);
    res.status(201).json({ data: driver });
}

export function unassignDriverVehicle(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const driverId = parseId(req.params.id, "Fahrer-ID");
    const vehicleId = parseId(req.params.vehicleId, "Fahrzeug-ID");
    const driver = DriverModel.unassignVehicle(driverId, vehicleId, companyId);

    notifyVehiclesChanged(companyId);
    res.json({ data: driver });
}

export function setDriverCurrentVehicle(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const driverId = parseId(req.params.id, "Fahrer-ID");
    const { vehicle_id } = parseDriverCurrentVehicle(req.body);
    const driver = DriverModel.setCurrentVehicle(
        driverId,
        vehicle_id,
        companyId,
    );

    notifyVehiclesChanged(companyId);
    res.json({ data: driver });
}
