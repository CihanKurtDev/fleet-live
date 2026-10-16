import { useCallback, useMemo, useState, type MouseEvent } from "react";
import type { Alert } from "@fleet-live/shared";

import { resolveAlert } from "../../api/alerts";
import { ApiError } from "../../api/client";
import { useVehicles } from "../../context/vehiclesContext";
import type { TableColumn } from "../../types/table";
import { formatTimestamp } from "../../utils/dateTime";
import { Button } from "../ui/Button/Button";
import { alertColumns } from "./alertTableConfig";
import styles from "./alertTableConfig.module.scss";

/**
 * Columns plus the row button "Erledigen" (open rows, dispatchers). The
 * button never navigates and hides itself in selection mode.
 */
export const useAlertResolveColumn = (
    canWrite: boolean,
    onResolved?: () => void,
) => {
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
                onResolved?.();
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
        [onResolved, refetchLists],
    );

    const actionColumn = useMemo<TableColumn<Alert>>(
        () => ({
            key: "resolved_at",
            displayText: "Erledigen",
            headerText: " ",
            width: "150px",
            render: (value, { row, selectionMode }) => {
                if (value) {
                    return (
                        <span className={`${styles.action} ${styles.muted}`}>
                            {formatTimestamp(value)}
                        </span>
                    );
                }

                if (!canWrite || selectionMode) {
                    return null;
                }

                const handleClick = (
                    event: MouseEvent<HTMLButtonElement>,
                ) => {
                    event.stopPropagation();
                    void resolve(row.id);
                };

                return (
                    <span className={styles.action}>
                        <Button
                            variant="secondary"
                            size="row"
                            disabled={resolvingId === row.id}
                            title={
                                row.type === "SPEEDING"
                                    ? "Aus der Liste nehmen. Zustand und Tempo-Farbe bleiben."
                                    : "Aus der Liste nehmen. Zustand am Fahrzeug bleibt."
                            }
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
