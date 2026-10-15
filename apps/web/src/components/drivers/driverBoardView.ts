import {
    DRIVER_TALK_MIN_OPEN_WARNINGS,
    type DueKind,
    type DueListItem,
    type DueListState,
} from "@fleet-live/shared";

import {
    DRIVER_LIST_VIEW,
    DRIVER_VIEW_PARAM,
} from "../../hooks/useDriverListQuery";

/** Row height in px of a board column. `DriverBoard.module.scss` uses the same. */
export const DRIVER_BOARD_ROW_HEIGHT = 56;
/** Rows per column when the column is not height-bound (stacked layout). */
export const DRIVER_BOARD_STACKED_ROWS = 4;
/** Rows loaded per list; a column never shows more. */
export const DRIVER_BOARD_LIMIT = 25;

/** Driver deadlines on the board, most urgent first. */
export const LICENCE_GROUPS: ReadonlyArray<{
    id: string;
    state: DueListState;
    kind: DueKind;
    label: string;
}> = [
    { id: "expired", state: "overdue", kind: "licence_expiry", label: "Abgelaufen" },
    { id: "check", state: "overdue", kind: "licence_check", label: "Kontrolle" },
    { id: "missing", state: "missing", kind: "licence_expiry", label: "Datum fehlt" },
    { id: "soon", state: "soon", kind: "licence_expiry", label: "Läuft ab" },
];

/** `JJJJ-MM-TT` as `MM.JJJJ`. */
const monthYear = (iso: string | null): string => {
    const match = iso ? /^(\d{4})-(\d{2})/.exec(iso) : null;
    return match ? `${match[2]}.${match[1]}` : "—";
};

/** Short state of one licence row, no legal statement. */
export function licenceStateText(row: DueListItem): string {
    if (row.kind === "licence_check") {
        if (row.due_on === null) {
            return "nie kontrolliert";
        }

        return row.state === "soon" ? "Kontrolle bald fällig" : "Kontrolle überfällig";
    }

    if (row.state === "missing") {
        return "Ablaufdatum fehlt";
    }

    if (row.state === "overdue") {
        return `abgelaufen ${monthYear(row.due_on)}`;
    }

    return `läuft ab ${monthYear(row.due_on)}`;
}

export function eligibilityText(vehicleCount: number): string {
    if (vehicleCount === 0) {
        return "keine Freigabe";
    }

    return `${vehicleCount} ${vehicleCount === 1 ? "Freigabe" : "Freigaben"} · nicht eingeteilt`;
}

const withSearch = (params: URLSearchParams, search: string) => {
    if (search) {
        params.set("search", search);
    }

    return params;
};

export function driverListPath(
    search: string,
    filter?: { min_open_warnings?: number; without_vehicle?: true },
): string {
    const params = new URLSearchParams();

    if (filter?.min_open_warnings !== undefined) {
        params.set("min_open_warnings", String(filter.min_open_warnings));
    }

    if (filter?.without_vehicle) {
        params.set("without_vehicle", "true");
    }

    withSearch(params, search);
    params.set(DRIVER_VIEW_PARAM, DRIVER_LIST_VIEW);

    return `/drivers?${params.toString()}`;
}

export const talkListPath = (search: string) =>
    driverListPath(search, { min_open_warnings: DRIVER_TALK_MIN_OPEN_WARNINGS });

export const withoutVehicleListPath = (search: string) =>
    driverListPath(search, { without_vehicle: true });

export function duePath(state: DueListState, kind: DueKind, search: string): string {
    const params = new URLSearchParams({ state, kind });
    return `/fristen?${withSearch(params, search).toString()}`;
}

export function driverAlertsPath(driverId: number): string {
    return `/alerts?${new URLSearchParams({
        driver_id: String(driverId),
        type: "SPEEDING",
    }).toString()}`;
}

/** Rows that fit `height`; the stacked layout reports 0 and shows a few. */
export function boardRowCount(height: number): number {
    return height > 0
        ? Math.max(1, Math.floor(height / DRIVER_BOARD_ROW_HEIGHT))
        : DRIVER_BOARD_STACKED_ROWS;
}
