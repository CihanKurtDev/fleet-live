import { useEffect, useRef, useState } from "react";
import type { DueKind, DueListQuery } from "@fleet-live/shared";

import { useDueList } from "../../hooks/useDueList";
import { TablePagination } from "../ui/Table/TablePagination";
import { DueGroup } from "./DueGroup";
import {
    DUE_GROUPS,
    allocateDueRows,
    dueGroupEmpty,
} from "./dueView";
import styles from "./DueBoard.module.scss";

/** Rows loaded per kind for the overview; the allocation never shows more. */
const OVERVIEW_LIMIT = 25;
/** Rows per kind when the list is not height-bound (stacked layout). */
const STACKED_ROWS = 3;

interface ListProps {
    query: DueListQuery;
    today: string;
    checkMonths: number;
}

/**
 * Height of the element; 0 while the layout lets it grow (stacked, where the
 * list does not scroll on its own). Read from the element's own style, so a
 * resize between both layouts is measured with the layout that applies.
 */
function useBoundHeight() {
    const ref = useRef<HTMLDivElement>(null);
    const [height, setHeight] = useState(0);

    useEffect(() => {
        const element = ref.current;
        if (!element) {
            return;
        }

        const measure = () => {
            const bound = getComputedStyle(element).overflowY !== "visible";
            setHeight(bound ? element.clientHeight : 0);
        };
        const observer = new ResizeObserver(measure);

        // The list can keep its height across a layout switch; the document
        // size always changes with the window.
        observer.observe(element);
        observer.observe(document.documentElement);
        window.addEventListener("resize", measure);
        measure();

        return () => {
            observer.disconnect();
            window.removeEventListener("resize", measure);
        };
    }, []);

    return { ref, height };
}

/** All kinds; rows are handed out so the list fills its height. */
export const DueOverview = ({
    query,
    today,
    checkMonths,
    onShowAll,
}: ListProps & { onShowAll: (kind: DueKind) => void }) => {
    const { ref, height } = useBoundHeight();
    const base = { ...query, page: 1, limit: OVERVIEW_LIMIT };
    const lists = {
        licence_expiry: useDueList({ ...base, kind: "licence_expiry" }),
        hu: useDueList({ ...base, kind: "hu" }),
        uvv: useDueList({ ...base, kind: "uvv" }),
        licence_check: useDueList({ ...base, kind: "licence_check" }),
    } satisfies Record<DueKind, ReturnType<typeof useDueList>>;

    const loaded = DUE_GROUPS.every((group) => !lists[group.kind].isLoading);
    const totals = DUE_GROUPS.map((group) => ({
        kind: group.kind,
        total: lists[group.kind].total,
    }));
    const alloc =
        height > 0
            ? allocateDueRows(totals, height)
            : Object.fromEntries(
                  totals.map((entry) => [entry.kind, Math.min(STACKED_ROWS, entry.total)]),
              );

    const shown = DUE_GROUPS.filter(
        (group) =>
            !loaded || lists[group.kind].total > 0 || lists[group.kind].error,
    );
    const calm = loaded
        ? DUE_GROUPS.filter(
              (group) => lists[group.kind].total === 0 && !lists[group.kind].error,
          )
        : [];
    const hasSearch = query.search.length > 0;

    return (
        <div ref={ref} className={styles.list}>
            {shown.map((group) => {
                const list = lists[group.kind];

                return (
                    <DueGroup
                        key={group.kind}
                        kind={group.kind}
                        title={group.title}
                        rows={list.data.slice(0, alloc[group.kind] ?? 0)}
                        total={list.total}
                        today={today}
                        checkMonths={checkMonths}
                        isLoading={!loaded}
                        isFetching={list.isFetching}
                        error={list.error}
                        onRetry={list.retry}
                        onShowAll={() => onShowAll(group.kind)}
                    />
                );
            })}

            {calm.length > 0 && (
                <p className={styles.calm}>
                    {hasSearch && calm.length === DUE_GROUPS.length
                        ? "Keine Treffer für die Suche."
                        : `Nichts offen: ${calm
                              .map((group) =>
                                  group.kind === "licence_check" && checkMonths === 0
                                      ? `${group.title} (aus)`
                                      : group.title,
                              )
                              .join(" · ")}`}
                </p>
            )}
        </div>
    );
};

/** One kind with pagination, from the URL page and limit. */
export const DueFullList = ({
    query,
    today,
    checkMonths,
    kind,
    onPageChange,
    onLimitChange,
}: ListProps & {
    kind: DueKind;
    onPageChange: (page: number) => void;
    onLimitChange: (limit: number) => void;
}) => {
    const list = useDueList({ ...query, kind });
    const group = DUE_GROUPS.find((entry) => entry.kind === kind);

    return (
        <div className={styles.list}>
            <DueGroup
                kind={kind}
                title={group?.title ?? kind}
                rows={list.data}
                total={list.total}
                today={today}
                checkMonths={checkMonths}
                isLoading={list.isLoading}
                isFetching={list.isFetching}
                error={list.error}
                onRetry={list.retry}
                footer={
                    !list.isLoading && list.total === 0 ? (
                        <p className={styles.calm}>
                            {dueGroupEmpty(kind, query.state, query.search.length > 0, checkMonths)}
                        </p>
                    ) : list.total > 0 ? (
                        <TablePagination
                            page={query.page}
                            pageCount={list.pageCount}
                            limit={query.limit}
                            total={list.total}
                            onPageChange={onPageChange}
                            onLimitChange={onLimitChange}
                        />
                    ) : null
                }
            />
        </div>
    );
};
