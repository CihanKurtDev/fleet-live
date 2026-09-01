import type { Request, Response } from "express";
import { parseDriverListQuery } from "@fleet-live/shared";
import { DriverModel } from "../models/driver.model";
import {
    BadRequestError,
    NotFoundError,
    UnauthorizedError,
} from "../lib/errors";

function parseId(value: string | string[] | undefined): number {
    if (typeof value !== "string") {
        throw new BadRequestError("Ungültige Fahrer-ID.");
    }

    const id = Number(value);
    if (!Number.isInteger(id) || id < 1) {
        throw new BadRequestError("Ungültige Fahrer-ID.");
    }

    return id;
}

function sessionCompany(req: Request): number {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    return req.user.company_id;
}

export function getDrivers(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const query = parseDriverListQuery(req.query);
    const started = performance.now();
    const result = DriverModel.list(query, companyId);
    const duration = performance.now() - started;

    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.setHeader("Server-Timing", `db;dur=${duration.toFixed(1)}`);
    res.json(result);
}

export function getDriverById(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const id = parseId(req.params.id);
    const driver = DriverModel.getDetail(id, companyId);

    if (!driver) {
        throw new NotFoundError("Fahrer nicht gefunden.");
    }

    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.json({ data: driver });
}
