import { Request, Response } from "express";
import {
    validateVehicleInput,
    type VehicleFieldErrors,
    type VehicleInput,
} from "@fleet-live/shared";
import { VehicleModel } from "../models/vehicle.model";

function parseId(value: string | string []): number | null {
    if (typeof value !== "string") {
        return null;
    } 

    const id = Number(value);
    if (!Number.isInteger(id) || id < 1) {
        return null;
    }
    return id;
}

function isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Error && error.message.includes("UNIQUE");
}

/**
 * Antwortet mit 400 und den Feldfehlern.
 * `error` bleibt für Clients erhalten, die nur eine Meldung anzeigen.
 */
function sendFieldErrors(res: Response, fields: VehicleFieldErrors) {
    const [firstMessage] = Object.values(fields);
    res.status(400).json({ error: firstMessage, fields });
}

/** Liest die beschreibbaren Felder aus dem Request-Body. */
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

export function getVehicles(req: Request, res: Response) {
    const vehicles = VehicleModel.getAll();
    res.json(vehicles);
}

export function getVehicleById(req: Request, res: Response) {
  const id = parseId(req.params.id);
    if (id === null) {
        res.status(400).json({ error: "Invalid vehicle id." });
        return;
    }

    const vehicle = VehicleModel.getById(id);
    if (!vehicle) {
        res.status(404).json({ error: "Vehicle not found." });
        return;
    }

    res.json(vehicle);
}

export function createVehicle(req: Request, res: Response) {
    const input = readInput(req.body);

    // fuel_level und status sind beim Anlegen optional,
    // das Model setzt dafür Standardwerte.
    const errors = validateVehicleInput(input, { partial: true });

    if (input.license_plate === undefined) {
        errors.license_plate = "Kennzeichen ist erforderlich.";
    }
    if (input.driver_name === undefined) {
        errors.driver_name = "Fahrer ist erforderlich.";
    }

    if (Object.keys(errors).length > 0) {
        sendFieldErrors(res, errors);
        return;
    }

    const { license_plate, driver_name, fuel_level, status } =
        trimStrings(input);

    try {
        const vehicle = VehicleModel.create({
            license_plate: license_plate!,
            driver_name: driver_name!,
            fuel_level,
            status,
        });
        res.status(201).json(vehicle);
    } catch (error) {
        if (isUniqueConstraintError(error)) {
            res.status(409).json({ error: "license_plate already exists." });
            return;
        }
        throw error;
    }
}

export function replaceVehicle(req: Request, res: Response) {
    const id = parseId(req.params.id);
    if (id === null) {
        res.status(400).json({ error: "Invalid vehicle id." });
        return;
    }

    const input = readInput(req.body);
    const errors = validateVehicleInput(input);

    if (Object.keys(errors).length > 0) {
        sendFieldErrors(res, errors);
        return;
    }

    try {
        const vehicle = VehicleModel.replace(
            id,
            trimStrings(input) as VehicleInput,
        );
        if (!vehicle) {
            res.status(404).json({ error: "Vehicle not found." });
            return;
        }
        res.json(vehicle);
    } catch (error) {
        if (isUniqueConstraintError(error)) {
            res.status(409).json({ error: "license_plate already exists." });
            return;
        }
        throw error;
    }
}

export function updateVehicle(req: Request, res: Response) {
    const id = parseId(req.params.id);
    if (id === null) {
        res.status(400).json({ error: "Invalid vehicle id." });
        return;
    }

    const input = readInput(req.body);

    if (Object.keys(input).length === 0) {
        res.status(400).json({ error: "At least one field is required." });
        return;
    }

    const errors = validateVehicleInput(input, { partial: true });

    if (Object.keys(errors).length > 0) {
        sendFieldErrors(res, errors);
        return;
    }

    try {
        const vehicle = VehicleModel.update(id, trimStrings(input));
        if (!vehicle) {
            res.status(404).json({ error: "Vehicle not found." });
            return;
        }
        res.json(vehicle);
    } catch (error) {
        if (isUniqueConstraintError(error)) {
            res.status(409).json({ error: "license_plate already exists." });
            return;
        }
        throw error;
    }
}

export function deleteVehicle(req: Request, res: Response) {
    const id = parseId(req.params.id);
    if (id === null) {
        res.status(400).json({ error: "Invalid vehicle id." });
        return;
    }

    const deleted = VehicleModel.delete(id);
    if (!deleted) {
        res.status(404).json({ error: "Vehicle not found." });
        return;
    }

    res.status(204).send();
}
