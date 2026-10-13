import type { DueListItem } from "@fleet-live/shared";
import {
    dueListQuerySchema,
    isDueKind,
    isDueListState,
    isDueSortKey,
    serializeDueListQuery,
    type DueListQuery,
} from "@fleet-live/shared";
import {
    createListQueryHook,
    toListQuerySchema,
    type ListQueryPatch,
} from "./createListQueryHook";

const readDueParams = (
    searchParams: URLSearchParams,
): Record<string, string | undefined> => ({
    state: searchParams.get("state") ?? undefined,
    kind: searchParams.get("kind") ?? undefined,
    search: searchParams.get("search") ?? "",
    sort: searchParams.get("sort") ?? undefined,
    dir: searchParams.get("dir") ?? undefined,
    page: searchParams.get("page") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
});

const useDueListQueryBase = createListQueryHook<
    DueListItem,
    DueListQuery,
    {
        setFilter: (filterId: string | null) => void;
        setKind: (kindId: string | null) => void;
        showOverdueChecks: () => void;
    }
>({
    schema: toListQuerySchema(dueListQuerySchema),
    isSortKey: (key) => isDueSortKey(key),
    serialize: serializeDueListQuery,
    readParams: readDueParams,
    fields: ["state", "kind", "search", "sort", "dir", "page", "limit"],
    defaultSort: { key: "due_on", dir: "asc", mode: "sticky" },
    debounceSearch: true,
    getFilterId: (query) => query.state,
    extra: (patch) => ({
        setFilter: (filterId: string | null) => {
            if (!isDueListState(filterId)) {
                return;
            }

            patch(
                {
                    state: filterId,
                    kind: null,
                } as ListQueryPatch<DueListQuery>,
                { replace: true, resetPage: true },
            );
        },
        setKind: (kindId: string | null) => {
            patch(
                {
                    kind: isDueKind(kindId) ? kindId : null,
                } as ListQueryPatch<DueListQuery>,
                { replace: true, resetPage: true },
            );
        },
        showOverdueChecks: () => {
            patch(
                {
                    state: "overdue",
                    kind: "licence_check",
                } as ListQueryPatch<DueListQuery>,
                { replace: true, resetPage: true },
            );
        },
    }),
});

export const useDueListQuery = () => {
    const {
        query,
        apiQuery,
        tableState,
        setSearch,
        setFilter,
        setKind,
        showOverdueChecks,
        handleSort,
        setPage,
        setLimit,
    } = useDueListQueryBase();

    return {
        query,
        apiQuery,
        tableState,
        setSearch,
        setFilter,
        setKind,
        showOverdueChecks,
        handleSort,
        setPage,
        setLimit,
    };
};
