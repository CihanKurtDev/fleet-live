import { useCallback, useMemo, useState } from "react";

type Key = string | number;
type Selection = { key: string; ids: Key[] };

/**
 * Selection as a mode ("Auswählen" … "Fertig") for a list page.
 *
 * `rowKeys` are the selectable keys on the current page. `resetKey` is the
 * list query (page, filter, sort, search): when it changes the selection is
 * empty, the mode stays on. Keys that leave the page after a refetch drop
 * out of the selection.
 */
export const useSelectionMode = <K extends Key>(
    rowKeys: readonly K[],
    resetKey: string,
) => {
    const [active, setActive] = useState(false);
    const [selection, setSelection] = useState<Selection>({
        key: resetKey,
        ids: [],
    });
    const stored = selection.key === resetKey ? selection.ids : null;

    const selectedIds = useMemo(
        () => (stored ? rowKeys.filter((key) => stored.includes(key)) : []),
        [rowKeys, stored],
    );
    const count = selectedIds.length;
    const allSelected = rowKeys.length > 0 && count === rowKeys.length;

    const toggle = useCallback(
        (id: K) => {
            setSelection((current) => {
                const ids = current.key === resetKey ? current.ids : [];

                return {
                    key: resetKey,
                    ids: ids.includes(id)
                        ? ids.filter((selected) => selected !== id)
                        : [...ids, id],
                };
            });
        },
        [resetKey],
    );

    const toggleAll = useCallback(() => {
        setSelection({ key: resetKey, ids: allSelected ? [] : [...rowKeys] });
    }, [allSelected, resetKey, rowKeys]);

    const start = useCallback(() => {
        setSelection({ key: resetKey, ids: [] });
        setActive(true);
    }, [resetKey]);

    const stop = useCallback(() => {
        setActive(false);
        setSelection({ key: resetKey, ids: [] });
    }, [resetKey]);

    return {
        /** Selection mode is on. */
        active,
        start,
        /** Leaves the mode and clears the selection ("Fertig", Escape). */
        stop,
        selectedIds,
        count,
        toggle,
        toggleAll,
        /** Props for the page checkbox in `SelectionBar`. */
        pageCheckbox: {
            checked: allSelected,
            indeterminate: count > 0 && !allSelected,
            disabled: rowKeys.length === 0,
            onChange: toggleAll,
        },
    };
};
