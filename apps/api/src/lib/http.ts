import type { Request } from "express";
import { BadRequestError, UnauthorizedError } from "./errors";
import { broadcast } from "../sse/hub";

/**
 * Liest eine positive Integer-ID aus der URL. `label` landet in der
 * Fehlermeldung, z. B. `"Fahrzeug-ID"` → „Ungültige Fahrzeug-ID.“
 */
export function parseId(
    value: string | string[] | undefined,
    label: string,
): number {
    if (typeof value !== "string") {
        throw new BadRequestError(`Ungültige ${label}.`);
    }

    const id = Number(value);
    if (!Number.isInteger(id) || id < 1) {
        throw new BadRequestError(`Ungültige ${label}.`);
    }

    return id;
}

/** Firma der Session. Wirft 401, wenn niemand angemeldet ist. */
export function sessionCompany(req: Request): number {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    return req.user.company_id;
}

/** Sagt der Live-Ansicht, dass sich Stammdaten dieser Firma geändert haben. */
export function notifyVehiclesChanged(companyId: number) {
    broadcast("vehicles-changed", { at: Date.now() }, companyId);
}
