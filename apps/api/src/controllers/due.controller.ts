import type { Request, Response } from "express";
import { parseDueListQuery } from "@fleet-live/shared";
import { sessionCompany } from "../lib/http";
import { DueModel } from "../models/due.model";

export function getDue(req: Request, res: Response) {
    const query = parseDueListQuery(req.query);
    const started = performance.now();
    const result = DueModel.listForCompany(sessionCompany(req), query);
    const duration = performance.now() - started;

    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.setHeader("Server-Timing", `db;dur=${duration.toFixed(1)}`);
    res.json(result);
}
