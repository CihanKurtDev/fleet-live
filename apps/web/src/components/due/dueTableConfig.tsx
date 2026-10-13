import {
    DUE_KIND_LABELS,
    DUE_KINDS,
    DUE_SOON_DAYS,
    dueExplanationText,
    type DueKind,
    type DueListItem,
    type DueListState,
} from "@fleet-live/shared";
import type { TableColumn, TableFilter } from "../../types/table";
import { formatIsoDate } from "../../utils/dateTime";
import styles from "./DueTable.module.scss";

export function dueSoonLabel(leadDays: number): string {
    return leadDays === 0 ? "Heute" : `In ${leadDays} Tagen`;
}

export function dueStateLabel(
    state: DueListState,
    leadDays = DUE_SOON_DAYS,
): string {
    if (state === "soon") {
        return dueSoonLabel(leadDays);
    }

    if (state === "missing") {
        return "Datum fehlt";
    }

    return "Überfällig";
}

export function dueStateFiltersFor(
    leadDays: number,
): Array<TableFilter<DueListItem> & { id: DueListState }> {
    return (["overdue", "soon", "missing"] as const).map((id) => ({
        id,
        displayText: dueStateLabel(id, leadDays),
    }));
}

export const dueKindFilters: Array<
    TableFilter<DueListItem> & { id: DueKind }
> = DUE_KINDS.map((id) => ({
    id,
    displayText: DUE_KIND_LABELS[id],
}));

const dueWhen = (row: DueListItem): string => {
    if (row.due_on === null && row.kind === "licence_check") {
        return "Nicht erfolgt";
    }

    return formatIsoDate(row.due_on);
};

export const dueColumns: TableColumn<DueListItem>[] = [
    {
        key: "label",
        displayText: "Wer",
        sortable: true,
    },
    {
        key: "kind",
        displayText: "Art",
        sortable: true,
        render: (value) => DUE_KIND_LABELS[value],
    },
    {
        key: "due_on",
        displayText: "Fällig",
        sortable: true,
        render: (_value, { row }) => (
            <span>
                {dueWhen(row)}
                {row.explanation && (
                    <span className={styles.reason}>
                        {dueExplanationText(row.kind, row.explanation)}
                    </span>
                )}
            </span>
        ),
    },
];
