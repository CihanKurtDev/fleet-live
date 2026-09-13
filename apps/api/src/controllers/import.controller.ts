import type { Request, Response } from "express";
import { ZodError } from "zod";
import {
    parseImportCommitInput,
    parseImportPreviewInput,
    parseImportProfileInput,
    parseImportRunListQuery,
} from "@fleet-live/shared";
import { ImportModel } from "../models/import.model";
import { BadRequestError, NotFoundError } from "../lib/errors";
import { notifyVehiclesChanged, sessionCompany } from "../lib/http";

function sessionUserId(req: Request): number {
    const userId = req.user?.id;
    if (userId === undefined) {
        throw new BadRequestError("Benutzer fehlt in der Sitzung.");
    }
    return userId;
}

function asBadRequest(error: unknown): never {
    if (error instanceof ZodError) {
        const first = error.issues[0]?.message ?? "Ungültige Eingabe.";
        throw new BadRequestError(first);
    }
    throw error;
}

export function previewImport(req: Request, res: Response): void {
    try {
        const input = parseImportPreviewInput(req.body);
        const companyId = sessionCompany(req);
        const userId = sessionUserId(req);

        const preview = ImportModel.preview(input, companyId, userId);

        if (preview.columns.length === 0) {
            throw new BadRequestError(
                "Die Datei enthält keine erkennbaren Spalten.",
            );
        }

        res.json({ data: preview });
    } catch (error) {
        asBadRequest(error);
    }
}

export function commitImport(req: Request, res: Response): void {
    try {
        const input = parseImportCommitInput(req.body);
        const companyId = sessionCompany(req);
        const userId = sessionUserId(req);

        const result = ImportModel.commit(
            input.preview_id,
            companyId,
            userId,
            input.row_actions,
            input.save_profile,
        );

        if (
            result.created_vehicles > 0 ||
            result.updated_vehicles > 0 ||
            result.set_current > 0 ||
            result.assigned_eligibility > 0
        ) {
            notifyVehiclesChanged(companyId);
        }

        res.json({ data: result });
    } catch (error) {
        if (error instanceof NotFoundError) {
            throw error;
        }
        asBadRequest(error);
    }
}

export function getImportProfile(req: Request, res: Response): void {
    const companyId = sessionCompany(req);
    res.json({ data: ImportModel.getProfile(companyId) });
}

export function putImportProfile(req: Request, res: Response): void {
    try {
        const input = parseImportProfileInput(req.body);
        const companyId = sessionCompany(req);
        const saved = ImportModel.putProfile(companyId, input);
        res.json({ data: saved });
    } catch (error) {
        asBadRequest(error);
    }
}

export function listImportRuns(req: Request, res: Response): void {
    try {
        const query = parseImportRunListQuery(req.query);
        const companyId = sessionCompany(req);
        res.json(ImportModel.listRuns(query, companyId));
    } catch (error) {
        asBadRequest(error);
    }
}
