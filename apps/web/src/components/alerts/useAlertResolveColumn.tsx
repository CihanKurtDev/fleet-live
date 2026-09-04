import { useCallback, useMemo, useState, type MouseEvent } from "react";
import type { Alert } from "@fleet-live/shared";

import { resolveAlert } from "../../api/alerts";
import { ApiError } from "../../api/client";
import { useVehicles } from "../../context/vehiclesContext";
import type { TableColumn } from "../../types/table";
import { formatTimestamp } from "../../utils/dateTime";
import { Button } from "../ui/Button/Button";
import { alertColumns } from "./alertTableConfig";
import styles from "./AlertTable.module.scss";

export const useAlertResolveColumn = (canWrite: boolean) => {
    const { refetchLists } = useVehicles();
    const [resolvingId, setResolvingId] = useState<number | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);

    const resolve = useCallback(
        async (id: number) => {
            setResolvingId(id);
            setActionError(null);

            try {
                await resolveAlert(id);
                refetchLists();
            } catch (caught) {
                setActionError(
                    caught instanceof ApiError
                        ? caught.message
                        : "Warnung konnte nicht erledigt werden.",
                );
            } finally {
                setResolvingId(null);
            }
        },
        [refetchLists],
    );

    const actionColumn = useMemo<TableColumn<Alert>>(
        () => ({
            key: "resolved_at",
            displayText: canWrite ? "Aktion" : "Status",
            render: (value, { row }) => {
                if (value) {
                    return (
                        <span className={styles.actionCell}>
                            {formatTimestamp(value)}
                        </span>
                    );
                }

                if (!canWrite) {
                    return (
                        <span className={styles.actionCell}>Offen</span>
                    );
                }

                const handleClick = (
                    event: MouseEvent<HTMLButtonElement>,
                ) => {
                    event.stopPropagation();
                    void resolve(row.id);
                };

                return (
                    <span className={styles.actionCell}>
                        <Button
                            variant="secondary"
                            size="sm"
                            disabled={resolvingId === row.id}
                            onClick={handleClick}
                        >
                            Erledigen
                        </Button>
                    </span>
                );
            },
        }),
        [canWrite, resolve, resolvingId],
    );

    const columns = useMemo(
        () => [...alertColumns, actionColumn],
        [actionColumn],
    );

    return { columns, actionError };
};
