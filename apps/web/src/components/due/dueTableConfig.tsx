import {
    DUE_KIND_LABELS,
    DUE_KINDS,
    type DueKind,
    type DueListItem,
    type DueListState,
} from "@fleet-live/shared";
import type { TableColumn, TableFilter } from "../../types/table";
import { formatIsoDate } from "../../utils/dateTime";

export const DUE_STATE_LABELS: Record<DueListState, string> = {
    overdue: "Überfällig",
    soon: "In 30 Tagen",
    missing: "Ohne Datum",
};

export const dueStateFilters: Array<
    TableFilter<DueListItem> & { id: DueListState }
> = (["overdue", "soon", "missing"] as const).map((id) => ({
    id,
    displayText: DUE_STATE_LABELS[id],
}));

export const dueKindFilters: Array<
    TableFilter<DueListItem> & { id: DueKind }
> = DUE_KINDS.map((id) => ({
    id,
    displayText: DUE_KIND_LABELS[id],
}));

const dueWhen = (row: DueListItem): string => {
    if (row.due_on === null && row.kind === "licence_check") {
        return "Noch nie kontrolliert";
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
        render: (_value, { row }) => dueWhen(row),
    },
];
