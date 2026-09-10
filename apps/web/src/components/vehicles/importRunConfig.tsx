import type { ImportRun } from "@fleet-live/shared";
import { formatTimestamp } from "../../utils/dateTime";
import type { TableColumn } from "../../types/table";

const SOURCE_LABELS: Record<ImportRun["source"], string> = {
    csv: "CSV",
    xlsx: "Excel",
};

export const importRunColumns: TableColumn<ImportRun>[] = [
    {
        key: "created_at",
        displayText: "Wann",
        render: (value) => formatTimestamp(value),
    },
    {
        key: "user_name",
        displayText: "Wer",
    },
    {
        key: "source",
        displayText: "Datei",
        render: (value) => SOURCE_LABELS[value],
    },
    {
        key: "created_vehicles",
        displayText: "Neu",
    },
    {
        key: "updated_vehicles",
        displayText: "Update",
    },
    {
        key: "warning_count",
        displayText: "Hinweise",
    },
];
