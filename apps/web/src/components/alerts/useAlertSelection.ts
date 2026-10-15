import { useCallback, useMemo, useState } from "react";
import type { Alert } from "@fleet-live/shared";

type Selection = { key: string; ids: number[] };

const isOpen = (alert: Alert) => alert.resolved_at === null;

/**
 * Auswahl offener Warnungen auf der aktuellen Seite. `resetKey` ist die
 * Listenabfrage: ändert sie sich (Seite, Filter, Sortierung), ist die
 * Auswahl leer. Zeilen, die nach einem Refetch fehlen oder erledigt sind,
 * fallen aus der Auswahl.
 */
export const useAlertSelection = (rows: Alert[], resetKey: string) => {
    const [selection, setSelection] = useState<Selection>({
        key: resetKey,
        ids: [],
    });
    const storedIds = selection.key === resetKey ? selection.ids : null;

    const openRows = useMemo(() => rows.filter(isOpen), [rows]);
    const selectedRows = useMemo(
        () =>
            storedIds
                ? openRows.filter((row) => storedIds.includes(row.id))
                : [],
        [openRows, storedIds],
    );

    const count = selectedRows.length;
    const allSelected = openRows.length > 0 && count === openRows.length;

    const toggle = useCallback(
        (id: number) => {
            setSelection((current) => {
                const ids = current.key === resetKey ? current.ids : [];

                return {
                    key: resetKey,
                    ids: ids.includes(id)
                        ? ids.filter((selectedId) => selectedId !== id)
                        : [...ids, id],
                };
            });
        },
        [resetKey],
    );

    const clear = useCallback(() => {
        setSelection({ key: resetKey, ids: [] });
    }, [resetKey]);

    const toggleAll = useCallback(() => {
        setSelection({
            key: resetKey,
            ids: allSelected ? [] : openRows.map((row) => row.id),
        });
    }, [allSelected, openRows, resetKey]);

    return {
        selectedRows,
        selectedIds: selectedRows.map((row) => row.id),
        count,
        allSelected,
        someSelected: count > 0 && !allSelected,
        hasSelectable: openRows.length > 0,
        isSelectable: isOpen,
        toggle,
        toggleAll,
        clear,
    };
};
