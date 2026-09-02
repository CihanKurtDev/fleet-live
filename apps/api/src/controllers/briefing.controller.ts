import type { Request, Response } from "express";
import { UnauthorizedError } from "../lib/errors";
import { BriefingModel } from "../models/briefing.model";

export function getBriefing(req: Request, res: Response) {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    const started = performance.now();
    const result = BriefingModel.forCompany(req.user.company_id);
    const duration = performance.now() - started;

    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.setHeader("Server-Timing", `db;dur=${duration.toFixed(1)}`);
    res.json(result);
}
