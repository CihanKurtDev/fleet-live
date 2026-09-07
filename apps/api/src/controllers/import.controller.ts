import type { Request, Response } from "express";
import { ZodError } from "zod";
import {
    parseImportCommitInput,
    parseImportPreviewInput,
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

export function previewImport(req: Request, res: Response): void {
    try {
        const input = parseImportPreviewInput(req.body);
        const companyId = sessionCompany(req);
        const userId = sessionUserId(req);

        const preview = ImportModel.preview(
            input.csv,
            companyId,
            userId,
            input.column_mapping,
            input.status_mapping,
        );

        if (preview.columns.length === 0) {
            throw new BadRequestError(
                "Die Datei enthält keine erkennbaren Spalten.",
            );
        }

        res.json({ data: preview });
    } catch (error) {
        if (error instanceof ZodError) {
            const first = error.issues[0]?.message ?? "Ungültige Eingabe.";
            throw new BadRequestError(first);
        }
        throw error;
    }
}

export function commitImport(req: Request, res: Response): void {
    try {
        const input = parseImportCommitInput(req.body);
        const companyId = sessionCompany(req);

        const result = ImportModel.commit(
            input.preview_id,
            companyId,
            input.row_actions,
        );

        if (
            result.created_vehicles > 0 ||
            result.updated_vehicles > 0
        ) {
            notifyVehiclesChanged(companyId);
        }

        res.json({ data: result });
    } catch (error) {
        if (error instanceof NotFoundError) {
            throw error;
        }
        if (error instanceof ZodError) {
            const first = error.issues[0]?.message ?? "Ungültige Eingabe.";
            throw new BadRequestError(first);
        }
        throw error;
    }
}
