import type { Alert } from "@fleet-live/shared";

import { formatTimestamp } from "../../utils/dateTime";
import { ConfirmDialog } from "../ui/Modal/ConfirmDialog";
import { warningCount } from "./alertLabels";

interface AlertBulkResolveDialogProps {
    rows: Alert[] | null;
    isBusy: boolean;
    error: string | null;
    onClose: () => void;
    onConfirm: () => void;
}

/** Confirm before the selected warnings are resolved (`PATCH /api/alerts`). */
export const AlertBulkResolveDialog = ({
    rows,
    isBusy,
    error,
    onClose,
    onConfirm,
}: AlertBulkResolveDialogProps) => {
    const count = rows?.length ?? 0;

    return (
        <ConfirmDialog
            open={rows !== null}
            onClose={onClose}
            title={`${warningCount(count)} erledigen?`}
            confirmLabel={`${count} erledigen`}
            busyLabel="Wird erledigt…"
            confirmVariant="primary"
            isBusy={isBusy}
            onConfirm={onConfirm}
            itemsLabel="Ausgewählte Warnungen"
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
