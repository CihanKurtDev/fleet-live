import type { Request } from "express";
import { AppError } from "./errors";
import { PrivacyModel } from "../models/privacy.model";

/** True when the company keeps driver names from this viewer. */
export function hidesDriverNames(req: Request): boolean {
    if (!req.user) {
        return false;
    }

    return !PrivacyModel.seesDriverNames(req.user.company_id, req.user.role);
}

/** A row without who drove, for a viewer the company keeps names from. */
export function withoutDriver<T extends { driver_id: number | null; driver_name: string | null }>(
    row: T,
): T {
    return { ...row, driver_id: null, driver_name: null };
}

export const DRIVER_NAMES_HIDDEN = "Fahrerdaten sind in dieser Firma Dispatchern vorbehalten.";

/** Driver pages for a viewer the company keeps names from: 403. */
export function requireDriverNames(req: Request, _res: unknown, next: () => void) {
    if (hidesDriverNames(req)) {
        throw new AppError(403, "DRIVER_NAMES_HIDDEN", DRIVER_NAMES_HIDDEN);
    }

    next();
}
