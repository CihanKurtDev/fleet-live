import type { Request, Response } from "express";
import { parseDueListQuery, resolveDueSettings } from "@fleet-live/shared";
import { sessionCompany } from "../lib/http";
import { CompanyModel } from "../models/company.model";
import { DueModel } from "../models/due.model";
import { NotFoundError } from "../lib/errors";

function settingsForCompany(companyId: number) {
    const stored = CompanyModel.dueSettings(companyId);

    if (!stored) {
        throw new NotFoundError("Firma nicht gefunden.");
    }

    return {
        ...stored,
        ...resolveDueSettings(stored),
    };
}

export function getDueSettings(req: Request, res: Response) {
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.json({ data: settingsForCompany(sessionCompany(req)) });
}

export function patchDueSettings(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    CompanyModel.updateDueSettings(companyId, req.body ?? {});
    res.json({ data: settingsForCompany(companyId) });
}

export function getDue(req: Request, res: Response) {
    const query = parseDueListQuery(req.query);
    const started = performance.now();
    const result = DueModel.listForCompany(sessionCompany(req), query);
    const duration = performance.now() - started;

    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.setHeader("Server-Timing", `db;dur=${duration.toFixed(1)}`);
    res.json(result);
}
