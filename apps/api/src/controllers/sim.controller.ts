import type { Request, Response } from "express";
import { parseSimPatch } from "@fleet-live/shared";
import { BadRequestError } from "../lib/errors";
import {
    isTelemetryTickerRunning,
    setTelemetryTickerRunning,
} from "../sse/telemetryTicker";
import { config } from "../config";

function simState() {
    return {
        running: isTelemetryTickerRunning(),
        available: config.telemetryTickMs > 0,
    };
}

export function getSim(_req: Request, res: Response) {
    res.json(simState());
}

export function updateSim(req: Request, res: Response) {
    const { running } = parseSimPatch(req.body);

    if (config.telemetryTickMs <= 0) {
        throw new BadRequestError("Simulation ist deaktiviert.");
    }

    setTelemetryTickerRunning(running);
    res.json(simState());
}
