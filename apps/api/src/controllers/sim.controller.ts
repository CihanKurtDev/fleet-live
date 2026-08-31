import type { Request, Response } from "express";
import { parseSimPatch } from "@fleet-live/shared";
import { BadRequestError, UnauthorizedError } from "../lib/errors";
import { config } from "../config";
import {
    isCompanySimRunning,
    setCompanySimRunning,
} from "../lib/simControl";

function sessionCompany(req: Request): number {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    return req.user.company_id;
}

function simState(companyId: number) {
    const available = config.telemetryTickMs > 0;

    return {
        running: available && isCompanySimRunning(companyId),
        available,
    };
}

export function getSim(req: Request, res: Response) {
    res.json(simState(sessionCompany(req)));
}

export function updateSim(req: Request, res: Response) {
    const { running } = parseSimPatch(req.body);

    if (config.telemetryTickMs <= 0) {
        throw new BadRequestError("Simulation ist deaktiviert.");
    }

    const companyId = sessionCompany(req);
    setCompanySimRunning(companyId, running);
    res.json(simState(companyId));
}
