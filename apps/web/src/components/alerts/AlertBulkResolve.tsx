import type { Alert } from "@fleet-live/shared";

import { formatTimestamp } from "../../utils/dateTime";
import { formatCount } from "../../utils/formatCount";
import { ConfirmDialog } from "../ui/Modal/ConfirmDialog";
import { warningCount } from "./alertLabels";

interface AlertBulkResolveDialogProps {
    rows: Alert[] | null;
    /** How many are affected; more than `rows` when all of a filter are meant. */
    count: number;
    isBusy: boolean;
    error: string | null;
    onClose: () => void;
    onConfirm: () => void;
}

/** Confirm before the selected warnings are resolved (`PATCH /api/alerts`). */
export const AlertBulkResolveDialog = ({
    rows,
    count,
    isBusy,
    error,
    onClose,
    onConfirm,
}: AlertBulkResolveDialogProps) => {
    return (
        <ConfirmDialog
            open={rows !== null}
            onClose={onClose}
            title={`${warningCount(count)} erledigen?`}
            confirmLabel={`${formatCount(count)} erledigen`}
            busyLabel="Wird erledigt…"
            confirmVariant="primary"
            isBusy={isBusy}
            onConfirm={onConfirm}
            itemsLabel="Ausgewählte Warnungen"
            moreCount={rows ? Math.max(0, count - Math.min(rows.length, 8)) : 0}
            items={rows?.map((row) => ({
                key: row.id,
                name: row.license_plate,
                detail: formatTimestamp(row.created_at),
            }))}
            error={error}
        >
            <p>
                {count === 1 ? "Sie verschwindet" : "Sie verschwinden"} aus
                „Offen“ und {count === 1 ? "bleibt" : "bleiben"} unter
                „Erledigt“ sichtbar.
            </p>
        </ConfirmDialog>
    );
};
