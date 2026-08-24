import { Request, Response } from "express";
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
    const { license_plate, driver_name, fuel_level, status } = req.body ?? {};

    if (typeof license_plate !== "string" || license_plate.trim() === "") {
        res.status(400).json({ error: "license_plate is required." });
        return;
    }
    if (typeof driver_name !== "string" || driver_name.trim() === "") {
        res.status(400).json({ error: "driver_name is required." });
        return;
    }

    try {
        const vehicle = VehicleModel.create({
            license_plate: license_plate.trim(),
            driver_name: driver_name.trim(),
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

    const { license_plate, driver_name, fuel_level, status } = req.body ?? {};

    if (typeof license_plate !== "string" || license_plate.trim() === "") {
        res.status(400).json({ error: "license_plate is required." });
        return;
    }
    if (typeof driver_name !== "string" || driver_name.trim() === "") {
        res.status(400).json({ error: "driver_name is required." });
        return;
    }
    if (typeof fuel_level !== "number") {
        res.status(400).json({ error: "fuel_level is required." });
        return;
    }
    if (typeof status !== "string" || status.trim() === "") {
        res.status(400).json({ error: "status is required." });
        return;
    }

    try {
        const vehicle = VehicleModel.replace(id, {
            license_plate: license_plate.trim(),
            driver_name: driver_name.trim(),
            fuel_level,
            status: status.trim(),
        });
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

    const { license_plate, driver_name, fuel_level, status } = req.body ?? {};
    const patch: {
        license_plate?: string;
        driver_name?: string;
        fuel_level?: number;
        status?: string;
    } = {};

    if (license_plate !== undefined) {
        if (typeof license_plate !== "string" || license_plate.trim() === "") {
            res.status(400).json({ error: "license_plate must be a non-empty string." });
            return;
        }
        patch.license_plate = license_plate.trim();
    }
    if (driver_name !== undefined) {
        if (typeof driver_name !== "string" || driver_name.trim() === "") {
            res.status(400).json({ error: "driver_name must be a non-empty string." });
            return;
        }
        patch.driver_name = driver_name.trim();
    }
    if (fuel_level !== undefined) {
        if (typeof fuel_level !== "number") {
            res.status(400).json({ error: "fuel_level must be a number." });
            return;
        }
        patch.fuel_level = fuel_level;
    }
    if (status !== undefined) {
        if (typeof status !== "string" || status.trim() === "") {
            res.status(400).json({ error: "status must be a non-empty string." });
            return;
        }
        patch.status = status.trim();
    }

    if (Object.keys(patch).length === 0) {
        res.status(400).json({ error: "At least one field is required." });
        return;
    }

    try {
        const vehicle = VehicleModel.update(id, patch);
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