import type { Request, Response } from "express";
import { hidesDriverNames, withoutDriver } from "../lib/driverNames";
import {
    parseFleetDriversQuery,
    parseFleetPositionsQuery,
    parseTelemetryHistoryQuery,
    parseTripListQuery,
    parseVehicleListQuery,
    validateVehicleInput,
    normalizeVin,
    parseHuDate,
    parseVehicleType,
    type Vehicle,
    type VehicleFieldErrors,
    type VehicleInput,
    type VehicleStatus,
} from "@fleet-live/shared";
import { VehicleModel } from "../models/vehicle.model";
import { TelemetryModel } from "../models/telemetry.model";
import { TripModel } from "../models/trip.model";
import { SpeedingEventModel } from "../models/speedingEvent.model";
import { ExceptionEventModel } from "../models/exceptionEvent.model";
import { OdometerModel } from "../models/odometer.model";
import {
    BadRequestError,
    ConflictError,
    NotFoundError,
    ValidationError,
} from "../lib/errors";
import {
    notifyVehiclesChanged,
    parseId as parseRouteId,
    sessionCompany,
} from "../lib/http";

function parseId(value: string | string[] | undefined): number {
    return parseRouteId(value, "Fahrzeug-ID");
}

function throwFieldErrors(fields: VehicleFieldErrors): never {
    const [firstMessage] = Object.values(fields);
    throw new ValidationError(firstMessage ?? "Ungültige Eingabe.", fields);
}

function emptyToNull(value: unknown): string | null {
    if (value === null || value === undefined) {
        return null;
    }

    const trimmed = String(value).trim();
    return trimmed === "" ? null : trimmed;
}

function readInput(body: unknown): Partial<VehicleInput> {
    const {
        license_plate,
        fuel_level,
        status,
        vin,
        vehicle_type,
        hu_due_on,
        uvv_checked_on,
        uvv_due_on,
        depot,
        home_site_id,
        cost_center,
        odometer_km,
    } = (body ?? {}) as Partial<VehicleInput> & Record<string, unknown>;

    const input: Partial<VehicleInput> = {};

    if (license_plate !== undefined) {
        input.license_plate = license_plate;
    }
    if (fuel_level !== undefined) {
        input.fuel_level = fuel_level;
    }
    if (status !== undefined) {
        input.status = status;
    }
    if (vin !== undefined) {
        const raw = emptyToNull(vin);
        input.vin = raw === null ? null : normalizeVin(raw);
    }
    if (vehicle_type !== undefined) {
        const raw = emptyToNull(vehicle_type);
        input.vehicle_type =
            raw === null ? null : (parseVehicleType(raw) ?? (raw as VehicleInput["vehicle_type"]));
    }
    if (hu_due_on !== undefined) {
        const raw = emptyToNull(hu_due_on);
        input.hu_due_on = raw === null ? null : (parseHuDate(raw) ?? raw);
    }
    if (uvv_checked_on !== undefined) {
        const raw = emptyToNull(uvv_checked_on);
        input.uvv_checked_on = raw === null ? null : (parseHuDate(raw) ?? raw);
    }
    if (uvv_due_on !== undefined) {
        const raw = emptyToNull(uvv_due_on);
        input.uvv_due_on = raw === null ? null : (parseHuDate(raw) ?? raw);
    }
    if (depot !== undefined) {
        input.depot = emptyToNull(depot);
    }
    if (home_site_id !== undefined) {
        input.home_site_id = home_site_id;
    }
    if (cost_center !== undefined) {
        input.cost_center = emptyToNull(cost_center);
    }
    if (odometer_km !== undefined) {
        input.odometer_km = odometer_km;
    }

    return input;
}

/**
 * Den Stand setzt nur das Anlegen; danach ändert ihn die Korrektur
 * (`POST /api/vehicles/:id/odometer`), damit jeder Wechsel im Verlauf steht.
 */
function refuseOdometerOnUpdate(input: Partial<VehicleInput>) {
    if (input.odometer_km !== undefined) {
        throwFieldErrors({
            odometer_km:
                "Den Kilometerstand über die Korrektur ändern, damit der Verlauf stimmt.",
        });
    }
}

function trimStrings(input: Partial<VehicleInput>): Partial<VehicleInput> {
    return {
        ...input,
        ...(input.license_plate !== undefined && {
            license_plate: input.license_plate.trim(),
        }),
    };
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
    companyId: number,
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
    SpeedingEventModel.endForVehicle(id);
    TripModel.close(id);
    TripModel.pruneClosedForCompany(companyId);

    return VehicleModel.getById(id, companyId) ?? updated;
}

const NEEDS_DRIVER_MESSAGE =
    "Ein Fahrzeug braucht einen aktuellen Fahrer, bevor es auf Fahrt gehen kann. Erst den Fahrer zuweisen, dann den Status setzen.";

/**
 * Ein Fahrzeug fährt nie ohne Fahrer. Der Status `DRIVING` ist nur mit einem
 * aktuellen Fahrer möglich; ohne ihn würde die Fahrt offen bleiben, ohne dass
 * die Simulation das Fahrzeug bewegt. Ein Fahrer lässt sich während der Fahrt
 * ohnehin nicht entfernen (`DriverModel`), damit gilt die Regel in beide Richtungen.
 */
function assertDriverForDriving(
    status: VehicleStatus | undefined,
    currentDriverId: number | null | undefined,
) {
    if (status === "DRIVING" && (currentDriverId ?? null) === null) {
        throw new ConflictError(NEEDS_DRIVER_MESSAGE, {
            status: NEEDS_DRIVER_MESSAGE,
        });
    }
}

function syncExceptions(vehicle: Vehicle, companyId: number): Vehicle {
    ExceptionEventModel.syncVehicle({
        id: vehicle.id,
        status: vehicle.status,
    });
    ExceptionEventModel.syncFuel(vehicle.id);
    return VehicleModel.getById(vehicle.id, companyId) ?? vehicle;
}

export function getVehicles(req: Request, res: Response) {
    const started = performance.now();
    const query = parseVehicleListQuery(req.query);
    const result = VehicleModel.list(query, sessionCompany(req));
    const duration = performance.now() - started;

    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.setHeader("Server-Timing", `db;dur=${duration.toFixed(1)}`);
    res.json(result);
}

/**
 * Letzte Positionen für die Flottenkarte. Kein Listen-Paging:
 * der Ausschnitt kommt über `bbox`, nicht über `page`.
 */
export function getVehiclePositions(req: Request, res: Response) {
    const query = parseFleetPositionsQuery(req.query);
    const result = VehicleModel.positions(query, sessionCompany(req));

    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.json(result);
}

export function getVehicleDrivers(req: Request, res: Response) {
    const query = parseFleetDriversQuery(req.query);

    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.json(VehicleModel.drivers(query, sessionCompany(req)));
}

export function getVehicleById(req: Request, res: Response) {
    const id = parseId(req.params.id);
    const vehicle = VehicleModel.getById(id, sessionCompany(req));

    if (!vehicle) {
        throw new NotFoundError();
    }

    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.json(vehicle);
}

export function getVehicleTelemetry(req: Request, res: Response) {
    const id = parseId(req.params.id);

    if (!VehicleModel.getById(id, sessionCompany(req))) {
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

    if (!VehicleModel.getById(id, sessionCompany(req))) {
        throw new NotFoundError();
    }

    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    const trip = TripModel.latestForVehicle(id, sessionCompany(req));
    res.json({ data: trip && hidesDriverNames(req) ? withoutDriver(trip) : trip });
}

export function getVehicleTrips(req: Request, res: Response) {
    const id = parseId(req.params.id);
    const companyId = sessionCompany(req);

    if (!VehicleModel.getById(id, companyId)) {
        throw new NotFoundError();
    }

    const query = parseTripListQuery(req.query);
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    const listed = TripModel.listForVehicle(id, companyId, query);
    res.json(hidesDriverNames(req) ? { ...listed, data: listed.data.map(withoutDriver) } : listed);
}

export function getVehicleTripById(req: Request, res: Response) {
    const id = parseId(req.params.id);
    const tripId = parseRouteId(req.params.tripId, "Fahrt-ID");
    const companyId = sessionCompany(req);

    if (!VehicleModel.getById(id, companyId)) {
        throw new NotFoundError();
    }

    const trip = TripModel.getById(tripId, id, companyId);
    if (!trip) {
        throw new NotFoundError("Fahrt nicht gefunden.");
    }

    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.json({ data: hidesDriverNames(req) ? withoutDriver(trip) : trip });
}

export function createVehicle(req: Request, res: Response) {
    const input = readInput(req.body);
    const errors = validateVehicleInput(input, { partial: true });

    if (input.license_plate === undefined) {
        errors.license_plate = "Kennzeichen ist erforderlich.";
    }

    if (Object.keys(errors).length > 0) {
        throwFieldErrors(errors);
    }

    const { license_plate, fuel_level, status } =
        trimStrings(input);

    // Ein neues Fahrzeug hat noch keinen Fahrer, `DRIVING` ist hier nie gültig.
    assertDriverForDriving(status, null);

    const vehicle = VehicleModel.create({
        license_plate: license_plate!,
        fuel_level,
        status,
        vin: input.vin,
        vehicle_type: input.vehicle_type,
        hu_due_on: input.hu_due_on,
        uvv_checked_on: input.uvv_checked_on,
        uvv_due_on: input.uvv_due_on,
        depot: input.depot,
        home_site_id: input.home_site_id,
        cost_center: input.cost_center,
        company_id: sessionCompany(req),
    });

    if (vehicle.status === "DRIVING") {
        TripModel.open(vehicle.id);
    }

    if (input.odometer_km !== undefined && input.odometer_km !== null) {
        OdometerModel.set(
            vehicle.id,
            sessionCompany(req),
            input.odometer_km,
            "CREATE",
            req.user ? { id: req.user.id, name: req.user.name } : null,
        );
    }

    const created = syncExceptions(vehicle, sessionCompany(req));
    notifyVehiclesChanged(sessionCompany(req));
    res.status(201).location(`/api/vehicles/${vehicle.id}`).json(created);
}

export function replaceVehicle(req: Request, res: Response) {
    const id = parseId(req.params.id);
    const input = readInput(req.body);
    refuseOdometerOnUpdate(input);
    const errors = validateVehicleInput(input);

    if (Object.keys(errors).length > 0) {
        throwFieldErrors(errors);
    }

    const companyId = sessionCompany(req);
    const previous = VehicleModel.getById(id, companyId);

    if (previous) {
        assertDriverForDriving(input.status, previous.current_driver_id);
    }

    const vehicle = VehicleModel.replace(
        id,
        trimStrings(input) as VehicleInput,
        companyId,
    );

    if (!vehicle) {
        throw new NotFoundError();
    }

    notifyVehiclesChanged(companyId);
    res.json(
        syncExceptions(
            syncTrip(id, previous?.status, vehicle, companyId),
            companyId,
        ),
    );
}

export function updateVehicle(req: Request, res: Response) {
    const id = parseId(req.params.id);
    const input = readInput(req.body);

    if (Object.keys(input).length === 0) {
        throw new BadRequestError("Mindestens ein Feld ist erforderlich.");
    }

    refuseOdometerOnUpdate(input);
    const errors = validateVehicleInput(input, { partial: true });

    if (Object.keys(errors).length > 0) {
        throwFieldErrors(errors);
    }

    const companyId = sessionCompany(req);
    const previous = VehicleModel.getById(id, companyId);

    if (previous) {
        assertDriverForDriving(
            input.status ?? previous.status,
            previous.current_driver_id,
        );
    }

    const vehicle = VehicleModel.update(id, trimStrings(input), companyId);

    if (!vehicle) {
        throw new NotFoundError();
    }

    notifyVehiclesChanged(companyId);
    res.json(
        syncExceptions(
            syncTrip(id, previous?.status, vehicle, companyId),
            companyId,
        ),
    );
}

export function deleteVehicle(req: Request, res: Response) {
    const id = parseId(req.params.id);
    const companyId = sessionCompany(req);
    const vehicle = VehicleModel.getById(id, companyId);

    // Wie beim Fahrer: Was gerade unterwegs ist, wird nicht gelöscht.
    if (vehicle?.status === "DRIVING") {
        const message = `${vehicle.license_plate} ist unterwegs. Das Fahrzeug lässt sich erst nach der Fahrt löschen.`;

        throw new ConflictError(message, { vehicle_id: message });
    }

    const deleted = VehicleModel.delete(id, companyId);

    if (!deleted) {
        throw new NotFoundError();
    }

    notifyVehiclesChanged(companyId);
    res.status(204).send();
}
