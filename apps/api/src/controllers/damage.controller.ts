import type { Request, Response } from "express";
import { isDamagePhotoType, parseDamageInput, parseDamagePatch } from "@fleet-live/shared";

import { AppError, UnauthorizedError } from "../lib/errors";
import { notifyVehiclesChanged, parseId, sessionCompany } from "../lib/http";
import { DamageModel } from "../models/damage.model";

export function getVehicleDamages(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const vehicleId = parseId(req.params.id, "Fahrzeug-ID");
    res.json({ data: DamageModel.forVehicle(vehicleId, companyId) });
}

export function createVehicleDamage(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const vehicleId = parseId(req.params.id, "Fahrzeug-ID");

    if (!req.user) {
        throw new UnauthorizedError();
    }

    const damage = DamageModel.create(vehicleId, companyId, parseDamageInput(req.body), {
        id: req.user.id,
        name: req.user.name,
    });
    notifyVehiclesChanged(companyId);
    res.status(201).json({ data: damage });
}

export function patchDamage(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const damageId = parseId(req.params.damageId, "Schaden-ID");
    const damage = DamageModel.update(
        damageId,
        companyId,
        parseDamagePatch(req.body),
        req.user ? { id: req.user.id, name: req.user.name } : null,
    );
    notifyVehiclesChanged(companyId);
    res.json({ data: damage });
}

export function closeDamage(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const damageId = parseId(req.params.damageId, "Schaden-ID");
    const damage = DamageModel.close(damageId, companyId);
    notifyVehiclesChanged(companyId);
    res.json({ data: damage });
}

export function addDamagePhoto(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const damageId = parseId(req.params.damageId, "Schaden-ID");
    const type = req.get("Content-Type")?.split(";")[0]?.trim();

    if (!isDamagePhotoType(type) || !Buffer.isBuffer(req.body)) {
        const message = "Die Datei ist kein JPEG-, PNG- oder WebP-Bild.";
        throw new AppError(415, "DAMAGE_PHOTO_TYPE", message, { photos: message });
    }

    const damage = DamageModel.addPhoto(damageId, companyId, {
        content_type: type,
        data: new Uint8Array(req.body),
    });
    res.status(201).json({ data: damage });
}

export function getDamagePhoto(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const damageId = parseId(req.params.damageId, "Schaden-ID");
    const photoId = parseId(req.params.photoId, "Foto-ID");
    const photo = DamageModel.photo(damageId, photoId, companyId);

    // A photo never changes under its id; it may stay in this browser only.
    res.setHeader("Cache-Control", "private, max-age=86400, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.type(photo.content_type).send(Buffer.from(photo.data));
}

export function deleteDamagePhoto(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const damageId = parseId(req.params.damageId, "Schaden-ID");
    const photoId = parseId(req.params.photoId, "Foto-ID");
    res.json({ data: DamageModel.deletePhoto(damageId, photoId, companyId) });
}
