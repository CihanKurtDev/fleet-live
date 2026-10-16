import type { Site } from "@fleet-live/shared";

export type DepotDraft = {
    id: number | "new";
    name: string;
    latitude: number;
    longitude: number;
    radius_m: number;
};

const POSITION_EPSILON = 1e-6;

export function isDepotDraftDirty(draft: DepotDraft, sites: Site[]): boolean {
    if (draft.id === "new") {
        return true;
    }

    const site = sites.find((item) => item.id === draft.id);

    if (!site) {
        return true;
    }

    return (
        draft.name.trim() !== site.name ||
        draft.radius_m !== site.radius_m ||
        Math.abs(draft.latitude - site.latitude) > POSITION_EPSILON ||
        Math.abs(draft.longitude - site.longitude) > POSITION_EPSILON
    );
}

/**
 * The depot selected after a click on `clickedId`: a click on the depot that
 * is already selected clears the selection, unless a placement or an edit is
 * open. One depot at a time stays the rule.
 */
export function depotAfterClick(
    currentId: number | undefined,
    clickedId: number,
    editing: boolean,
): number | null {
    return !editing && currentId === clickedId ? null : clickedId;
}
