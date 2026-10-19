import {
    formatAlertEvent,
    isSelfClosingAlertType,
    type Alert,
    type AlertFilterId,
    type AlertListMeta,
    type AlertType,
} from "@fleet-live/shared";
import type { TableColumn } from "../../types/table";
import { formatTimestamp } from "../../utils/dateTime";
import type { KpiTileTone } from "../ui/KpiTiles/KpiTiles";
import { AlertTypeChip } from "./AlertSemantics";
import styles from "./alertTableConfig.module.scss";

type AlertTileId = "open" | AlertType | "resolved";

type AlertTileOption = {
    id: AlertTileId;
    label: string;
    tone?: KpiTileTone;
    /** The URL state the tile sets. */
    view: { filter: AlertFilterId; type: AlertType | null };
};

/** KPI tiles on `/alerts`: the main filter, exactly one is pressed. */
export const alertTiles: AlertTileOption[] = [
    { id: "open", label: "Offen", view: { filter: "open", type: null } },
    {
        id: "SPEEDING",
        label: "Tempo",
        tone: "critical",
        view: { filter: "open", type: "SPEEDING" },
    },
    {
        id: "OFFLINE",
        label: "Kein Signal",
        view: { filter: "open", type: "OFFLINE" },
    },
    {
        id: "LOW_FUEL",
        label: "Wenig Tank",
        tone: "warning",
        view: { filter: "open", type: "LOW_FUEL" },
    },
    {
        id: "resolved",
        label: "Erledigt",
        view: { filter: "resolved", type: null },
    },
];

/**
 * A dispatcher closes an open warning by hand, except the ones that follow a
 * state (Wenig Tank, Kein Signal): they close themselves when the state is over.
 */
export const canResolveByHand = (
    alert: Pick<Alert, "type" | "resolved_at">,
) => alert.resolved_at === null && !isSelfClosingAlertType(alert.type);

/** The tile that is pressed for the current query. */
export const activeAlertTile = (
    query: { filter: AlertFilterId; type?: AlertType },
): AlertTileId => {
    if (query.filter === "resolved") {
        return "resolved";
    }

    return query.type ?? "open";
};

/** The number a tile shows; `null` while it is not known yet. */
export const alertTileCount = (
    id: AlertTileId,
    counts: AlertListMeta["counts"] | undefined,
    openTypeCounts: AlertListMeta["type_counts"] | null,
): number | null => {
    if (id === "open") {
        return counts?.open ?? null;
    }

    if (id === "resolved") {
        return counts?.resolved ?? null;
    }

    return openTypeCounts?.[id] ?? null;
};

/** Columns without the row button (`useAlertResolveColumn` adds it). */
export const alertColumns: TableColumn<Alert>[] = [
    {
        key: "license_plate",
        displayText: "Fahrzeug und Fahrer",
        headerText: "Fahrzeug · Fahrer",
        width: "220px",
        sortable: true,
        // Plain text: the row opens the vehicle.
        render: (value, { row }) => (
            <span className={styles.identity}>
                <span className={styles.plate} data-part="plate">
                    {value}
                </span>
                <span
                    className={styles.driver}
                    data-part="driver"
                    title={row.driver_name ?? undefined}
                >
                    {row.driver_name ?? "ohne Fahrer"}
                </span>
            </span>
        ),
    },
    {
        key: "type",
        displayText: "Art",
        width: "120px",
        sortable: true,
        render: (value) => <AlertTypeChip type={value} />,
    },
    {
        key: "message",
        displayText: "Ereignis",
        render: (_value, { row }) => formatAlertEvent(row),
    },
    {
        key: "created_at",
        displayText: "Zeitpunkt",
        width: "170px",
        sortable: true,
        render: (value) => formatTimestamp(value),
    },
];
