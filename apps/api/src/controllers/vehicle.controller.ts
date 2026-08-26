import type { Request, Response } from "express";
import {
    parseVehicleListQuery,
    validateVehicleInput,
    type VehicleFieldErrors,
    type VehicleInput,
} from "@fleet-live/shared";
import { VehicleModel } from "../models/vehicle.model";
import {
    BadRequestError,
    NotFoundError,
    ValidationError,
} from "../lib/errors";
import { broadcast } from "../sse/hub";

function parseId(value: string | string[] | undefined): number {
    if (typeof value !== "string") {
        throw new BadRequestError("Invalid vehicle id.");
    }

    const id = Number(value);
    if (!Number.isInteger(id) || id < 1) {
        throw new BadRequestError("Invalid vehicle id.");
    }

    return id;
}

function throwFieldErrors(fields: VehicleFieldErrors): never {
    const [firstMessage] = Object.values(fields);
    throw new ValidationError(firstMessage ?? "Invalid input.", fields);
}

function readInput(body: unknown): Partial<VehicleInput> {
    const { license_plate, driver_name, fuel_level, status } =
        (body ?? {}) as Partial<VehicleInput>;

    const input: Partial<VehicleInput> = {};

    if (license_plate !== undefined) {
        input.license_plate = license_plate;
    }
    if (driver_name !== undefined) {
        input.driver_name = driver_name;
    }
    if (fuel_level !== undefined) {
        input.fuel_level = fuel_level;
    }
    if (status !== undefined) {
        input.status = status;
    }

    return input;
}

function trimStrings(input: Partial<VehicleInput>): Partial<VehicleInput> {
    return {
        ...input,
        ...(input.license_plate !== undefined && {
            license_plate: input.license_plate.trim(),
        }),
        ...(input.driver_name !== undefined && {
            driver_name: input.driver_name.trim(),
        }),
    };
}

function notifyVehiclesChanged() {
    broadcast("vehicles-changed", { at: Date.now() });
}

export function getVehicles(req: Request, res: Response) {
    const started = performance.now();
    const query = parseVehicleListQuery(req.query);
    const result = VehicleModel.list(query);
    const duration = performance.now() - started;

    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.setHeader("Server-Timing", `db;dur=${duration.toFixed(1)}`);
    res.json(result);
}

export function getVehicleById(req: Request, res: Response) {
    const id = parseId(req.params.id);
    const vehicle = VehicleModel.getById(id);

    if (!vehicle) {
        throw new NotFoundError();
    }

    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.json(vehicle);
}

export function createVehicle(req: Request, res: Response) {
    const input = readInput(req.body);
    const errors = validateVehicleInput(input, { partial: true });

    if (input.license_plate === undefined) {
        errors.license_plate = "Kennzeichen ist erforderlich.";
    }
    if (input.driver_name === undefined) {
        errors.driver_name = "Fahrer ist erforderlich.";
    }

    if (Object.keys(errors).length > 0) {
        throwFieldErrors(errors);
    }

    const { license_plate, driver_name, fuel_level, status } =
        trimStrings(input);

    const vehicle = VehicleModel.create({
        license_plate: license_plate!,
        driver_name: driver_name!,
        fuel_level,
        status,
    });

    notifyVehiclesChanged();
    res.status(201).json(vehicle);
}

export function replaceVehicle(req: Request, res: Response) {
    const id = parseId(req.params.id);
    const input = readInput(req.body);
    const errors = validateVehicleInput(input);

    if (Object.keys(errors).length > 0) {
        throwFieldErrors(errors);
    }

    const vehicle = VehicleModel.replace(
        id,
        trimStrings(input) as VehicleInput,
    );

    if (!vehicle) {
        throw new NotFoundError();
    }

    notifyVehiclesChanged();
    res.json(vehicle);
}

export function updateVehicle(req: Request, res: Response) {
    const id = parseId(req.params.id);
    const input = readInput(req.body);

    if (Object.keys(input).length === 0) {
        throw new BadRequestError("At least one field is required.");
    }

    const errors = validateVehicleInput(input, { partial: true });

    if (Object.keys(errors).length > 0) {
        throwFieldErrors(errors);
    }

    const vehicle = VehicleModel.update(id, trimStrings(input));

    if (!vehicle) {
        throw new NotFoundError();
    }

    notifyVehiclesChanged();
    res.json(vehicle);
}

export function deleteVehicle(req: Request, res: Response) {
    const id = parseId(req.params.id);
    const deleted = VehicleModel.delete(id);

    if (!deleted) {
        throw new NotFoundError();
    }

    notifyVehiclesChanged();
    res.status(204).send();
}
