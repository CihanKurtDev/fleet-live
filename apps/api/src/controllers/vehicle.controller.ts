import type { Request, Response } from "express";
import {
    parseTelemetryHistoryQuery,
    parseVehicleListQuery,
    validateVehicleInput,
    type Vehicle,
    type VehicleFieldErrors,
    type VehicleInput,
    type VehicleStatus,
} from "@fleet-live/shared";
import { VehicleModel } from "../models/vehicle.model";
import { TelemetryModel } from "../models/telemetry.model";
import { TripModel } from "../models/trip.model";
import {
    BadRequestError,
    NotFoundError,
    ValidationError,
} from "../lib/errors";
import { broadcast } from "../sse/hub";

function parseId(value: string | string[] | undefined): number {
    if (typeof value !== "string") {
        throw new BadRequestError("Ungültige Fahrzeug-ID.");
    }

    const id = Number(value);
    if (!Number.isInteger(id) || id < 1) {
        throw new BadRequestError("Ungültige Fahrzeug-ID.");
    }

    return id;
}

function throwFieldErrors(fields: VehicleFieldErrors): never {
    const [firstMessage] = Object.values(fields);
    throw new ValidationError(firstMessage ?? "Ungültige Eingabe.", fields);
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

/**
 * Hält die Fahrt am Status fest: `DRIVING` öffnet sie, jeder andere Status
 * beendet sie. Beim Beenden kommt ein Abschlusspunkt mit Tempo 0 dazu, damit
 * ein stehendes Fahrzeug nicht weiter mit Reisegeschwindigkeit erscheint.
 */
function syncTrip(
    id: number,
    previousStatus: VehicleStatus | undefined,
    updated: Vehicle,
): Vehicle {
    const wasDriving = previousStatus === "DRIVING";
    const isDriving = updated.status === "DRIVING";

    if (wasDriving === isDriving) {
        return updated;
    }

    if (isDriving) {
        TripModel.open(id);
        return updated;
    }

    TelemetryModel.recordStandstill(id);
    TripModel.close(id);

    return VehicleModel.getById(id) ?? updated;
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

export function getVehicleTelemetry(req: Request, res: Response) {
    const id = parseId(req.params.id);

    if (!VehicleModel.getById(id)) {
        throw new NotFoundError();
    }

    const query = parseTelemetryHistoryQuery(req.query);
    const data = TelemetryModel.listForVehicle(id, query.limit);

    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.json({ data });
}

/**
 * Der Streckenverlauf der laufenden Fahrt, sonst der der letzten beendeten.
 * `data: null`, solange das Fahrzeug nie gefahren ist — das ist kein Fehler.
 */
export function getVehicleTrip(req: Request, res: Response) {
    const id = parseId(req.params.id);

    if (!VehicleModel.getById(id)) {
        throw new NotFoundError();
    }

    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.json({ data: TripModel.latestForVehicle(id) });
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

    if (vehicle.status === "DRIVING") {
        TripModel.open(vehicle.id);
    }

    notifyVehiclesChanged();
    res.status(201).location(`/api/vehicles/${vehicle.id}`).json(vehicle);
}

export function replaceVehicle(req: Request, res: Response) {
    const id = parseId(req.params.id);
    const input = readInput(req.body);
    const errors = validateVehicleInput(input);

    if (Object.keys(errors).length > 0) {
        throwFieldErrors(errors);
    }

    const previous = VehicleModel.getById(id);
    const vehicle = VehicleModel.replace(
        id,
        trimStrings(input) as VehicleInput,
    );

    if (!vehicle) {
        throw new NotFoundError();
    }

    notifyVehiclesChanged();
    res.json(syncTrip(id, previous?.status, vehicle));
}

export function updateVehicle(req: Request, res: Response) {
    const id = parseId(req.params.id);
    const input = readInput(req.body);

    if (Object.keys(input).length === 0) {
        throw new BadRequestError("Mindestens ein Feld ist erforderlich.");
    }

    const errors = validateVehicleInput(input, { partial: true });

    if (Object.keys(errors).length > 0) {
        throwFieldErrors(errors);
    }

    const previous = VehicleModel.getById(id);
    const vehicle = VehicleModel.update(id, trimStrings(input));

    if (!vehicle) {
        throw new NotFoundError();
    }

    notifyVehiclesChanged();
    res.json(syncTrip(id, previous?.status, vehicle));
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
