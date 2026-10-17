import type { Request, Response } from "express";
import {
    encodePolyline,
    parseSimPatch,
    type SimRouteLine,
} from "@fleet-live/shared";
import { BadRequestError } from "../lib/errors";
import { sessionCompany } from "../lib/http";
import { config } from "../config";
import { simplifyPath } from "../lib/geo";
import { SIM_ROUTES } from "../sim/routes";
import {
    isCompanySimRunning,
    setCompanySimRunning,
} from "../lib/simControl";

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

/** Enough detail for the map at city zoom, a fraction of the baked points. */
const ROUTE_LINE_TOLERANCE_M = 40;
let routeLines: SimRouteLine[] | null = null;

/** The simulator's roads, the same for every company; encoded once. */
export function getSimRoutes(_req: Request, res: Response) {
    routeLines ??= SIM_ROUTES.map((route) => ({
        id: route.id,
        from: route.from,
        to: route.to,
        path: encodePolyline(
            simplifyPath(route.points, ROUTE_LINE_TOLERANCE_M),
        ),
    }));

    res.json({ data: routeLines });
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
