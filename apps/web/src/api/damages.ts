import type { Damage, DamageInput, DamageListResponse } from "@fleet-live/shared";

import { request } from "./client";

export function listVehicleDamages(vehicleId: number, signal?: AbortSignal) {
    return request<DamageListResponse>(`/api/vehicles/${vehicleId}/damages`, { signal });
}

export function reportDamage(vehicleId: number, input: DamageInput) {
    return request<{ data: Damage }>(`/api/vehicles/${vehicleId}/damages`, {
        method: "POST",
        body: input,
    });
}

export function updateDamage(damageId: number, patch: Partial<DamageInput>) {
    return request<{ data: Damage }>(`/api/damages/${damageId}`, {
        method: "PATCH",
        body: patch,
    });
}

export function addDamagePhoto(damageId: number, photo: Blob) {
    return request<{ data: Damage }>(`/api/damages/${damageId}/photos`, {
        method: "POST",
        file: photo,
        timeoutMs: 30_000,
    });
}

export function deleteDamagePhoto(damageId: number, photoId: number) {
    return request<{ data: Damage }>(`/api/damages/${damageId}/photos/${photoId}`, {
        method: "DELETE",
    });
}

/** Address of a stored photo, for an `<img>` (same origin, the session cookie goes along). */
export const damagePhotoUrl = (damageId: number, photoId: number) =>
    `/api/damages/${damageId}/photos/${photoId}`;

export function closeDamage(damageId: number) {
    return request<{ data: Damage }>(`/api/damages/${damageId}/close`, { method: "POST" });
}
