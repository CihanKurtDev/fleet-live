import type { Request, Response } from "express";
import { parseSiteInput, parseSitePatch } from "@fleet-live/shared";
import { SiteModel } from "../models/site.model";
import { NotFoundError } from "../lib/errors";
import { notifyVehiclesChanged, parseId, sessionCompany } from "../lib/http";

export function listSites(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    res.json({ data: SiteModel.list(companyId) });
}

export function createSite(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const input = parseSiteInput(req.body);
    const site = SiteModel.create(companyId, input);
    notifyVehiclesChanged(companyId);
    res.status(201).json(site);
}

export function updateSite(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const id = parseId(req.params.id, "Depot-ID");
    const input = parseSitePatch(req.body);
    const site = SiteModel.update(id, companyId, input);

    if (!site) {
        throw new NotFoundError("Depot nicht gefunden.");
    }

    notifyVehiclesChanged(companyId);
    res.json(site);
}

export function deleteSite(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const id = parseId(req.params.id, "Depot-ID");

    if (!SiteModel.delete(id, companyId)) {
        throw new NotFoundError("Depot nicht gefunden.");
    }

    notifyVehiclesChanged(companyId);
    res.status(204).end();
}
