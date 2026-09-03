import type { Request, Response } from "express";
import { sessionCompany } from "../lib/http";
import { BriefingModel } from "../models/briefing.model";

export function getBriefing(req: Request, res: Response) {
    const started = performance.now();
    const result = BriefingModel.forCompany(sessionCompany(req));
    const duration = performance.now() - started;

    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.setHeader("Server-Timing", `db;dur=${duration.toFixed(1)}`);
    res.json(result);
}
