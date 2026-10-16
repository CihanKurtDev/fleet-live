import { useState } from "react";
import type { AlertListMeta } from "@fleet-live/shared";

type TypeCounts = AlertListMeta["type_counts"];

/**
 * `meta.type_counts` follows the status filter, but the Tempo, Funk and
 * Wenig Tank tiles always count open warnings. While the Erledigt tile is
 * active the last open numbers stay on the tiles.
 */
export const useOpenTypeCounts = (
    meta: AlertListMeta | undefined,
    filter: string,
): TypeCounts | null => {
    const [stored, setStored] = useState<TypeCounts | null>(null);
    // Only a response for the open filter (type counts add up to the open
    // count); the previous response lingers while a new one loads.
    const fresh =
        filter === "open" && meta && meta.type_counts.all === meta.counts.open
            ? meta.type_counts
            : null;

    if (fresh && fresh !== stored) {
        setStored(fresh);
    }

    return fresh ?? stored;
};
