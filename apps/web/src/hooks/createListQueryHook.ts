import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import type { SortConfig, TableStateProps } from "../types/table";
import { useDebouncedValue } from "./useDebouncedValue";

type SortDir = "asc" | "desc";

export type ListQueryBase = {
    page: number;
    limit: number;
    dir: SortDir;
    sort?: string;
    search?: string;
};

export type ListQueryPatch<TQuery> = {
    [K in keyof TQuery]?: TQuery[K] | null;
};

export type ListQueryPatchOptions = {
    replace?: boolean;
    resetPage?: boolean;
};

export type ListQueryDefaultSort<TSort extends string = string> = {
    key: TSort;
    dir: SortDir;
    /**
     * `implied`: fehlendes URL-`sort` zählt im Zyklus und in `tableState`
     * (Fahrer: `name`).
     * `sticky`: Sortierung wird nicht gelöscht; nach `desc` zurück zum Default
     * (Alerts: `created_at` desc).
     */
    mode: "implied" | "sticky";
};

type ListQuerySchema<TQuery> = {
    safeParse: (
        data: unknown,
    ) => { success: true; data: TQuery } | { success: false };
    parse: (data: unknown) => TQuery;
};

type ListQueryPicker = {
    pick: (mask: Record<string, true>) => {
        safeParse: (
            data: unknown,
        ) => { success: true; data: object } | { success: false };
    };
};

/** Zod `.pick` ist masken-invariant; Laufzeit bleibt `{ [field]: true }`. */
export const toListQuerySchema = <TQuery>(
    schema: ListQuerySchema<TQuery> & {
        pick: (mask: never) => {
            safeParse: (
                data: unknown,
            ) => { success: true; data: object } | { success: false };
        };
    },
): ListQuerySchema<TQuery> & ListQueryPicker => ({
    safeParse: (data) => schema.safeParse(data),
    parse: (data) => schema.parse(data),
    pick: (mask) => schema.pick(mask as never),
});

type ListQueryHookConfig<
    TRow,
    TQuery extends ListQueryBase,
    TExtra extends object,
> = {
    schema: ListQuerySchema<TQuery> & ListQueryPicker;
    isSortKey: (key: keyof TRow & string) => boolean;
    serialize: (query: TQuery) => URLSearchParams;
    readParams: (
        searchParams: URLSearchParams,
    ) => Record<string, string | undefined>;
    fields: readonly (keyof TQuery & string)[];
    defaultSort?: ListQueryDefaultSort<string>;
    debounceSearch?: boolean;
    getSearch?: (query: TQuery) => string;
    getFilterId?: (query: TQuery) => string | null;
    extra?: (
        patch: (
            updates: ListQueryPatch<TQuery>,
            options?: ListQueryPatchOptions,
        ) => void,
    ) => TExtra;
};

const parseParams = <TQuery>(
    searchParams: URLSearchParams,
    schema: ListQuerySchema<TQuery> & ListQueryPicker,
    readParams: (
        searchParams: URLSearchParams,
    ) => Record<string, string | undefined>,
    fields: readonly string[],
): TQuery => {
    const raw = readParams(searchParams);
    const parsed = schema.safeParse(raw);

    if (parsed.success) {
        return parsed.data;
    }

    const kept: Record<string, unknown> = {};
    const candidates = fields.map((field) =>
        schema.pick({ [field]: true }).safeParse({
            [field]: raw[field],
        }),
    );

    for (const result of candidates) {
        if (result.success) {
            Object.assign(kept, result.data);
        }
    }

    return schema.parse(kept);
};

const applyPatch = <TQuery extends ListQueryBase>(
    previous: TQuery,
    updates: ListQueryPatch<TQuery>,
    options: ListQueryPatchOptions,
): TQuery => {
    const next = { ...previous };

    for (const key of Object.keys(updates) as (keyof TQuery)[]) {
        const value = updates[key];

        if (value === undefined) {
            continue;
        }

        if (value === null) {
            next[key] = undefined as TQuery[keyof TQuery];
        } else {
            next[key] = value as TQuery[keyof TQuery];
        }
    }

    if (options.resetPage) {
        next.page = 1;
    }

    return next;
};

const nextSort = <TQuery extends ListQueryBase>(
    query: TQuery,
    key: string,
    defaultSort?: ListQueryDefaultSort,
): { sort: string | null; dir: SortDir } => {
    if (!defaultSort) {
        if (!query.sort || query.sort !== key) {
            return { sort: key, dir: "asc" };
        }

        if (query.dir === "asc") {
            return { sort: key, dir: "desc" };
        }

        return { sort: null, dir: "asc" };
    }

    if (defaultSort.mode === "implied") {
        const current = query.sort ?? defaultSort.key;

        if (current !== key) {
            return { sort: key, dir: "asc" };
        }

        if (query.dir === "asc") {
            return { sort: key, dir: "desc" };
        }

        return { sort: null, dir: "asc" };
    }

    if (query.sort !== key) {
        return {
            sort: key,
            dir: key === defaultSort.key ? defaultSort.dir : "asc",
        };
    }

    if (key === defaultSort.key) {
        return {
            sort: defaultSort.key,
            dir: query.dir === "desc" ? "asc" : "desc",
        };
    }

    if (query.dir === "asc") {
        return { sort: key, dir: "desc" };
    }

    return { sort: defaultSort.key, dir: defaultSort.dir };
};

const tableSortConfig = <TRow, TQuery extends ListQueryBase>(
    query: TQuery,
    defaultSort?: ListQueryDefaultSort,
): SortConfig<TRow> => {
    if (query.sort) {
        return {
            key: query.sort as keyof TRow,
            direction: query.dir,
        };
    }

    if (defaultSort?.mode === "implied") {
        return {
            key: defaultSort.key as keyof TRow,
            direction: defaultSort.dir,
        };
    }

    return null;
};

export const createListQueryHook = <
    TRow,
    TQuery extends ListQueryBase,
    TExtra extends object = Record<string, never>,
>(
    config: ListQueryHookConfig<TRow, TQuery, TExtra>,
) => {
    const useListQuery = () => {
        const [searchParams, setSearchParams] = useSearchParams();
        const query = useMemo(
            () =>
                parseParams(
                    searchParams,
                    config.schema,
                    config.readParams,
                    config.fields,
                ),
            [searchParams],
        );
        const searchValue = config.getSearch?.(query) ?? query.search ?? "";
        const debouncedSearch = useDebouncedValue(searchValue);

        useEffect(() => {
            const canonical = config.serialize(query);

            if (searchParams.toString() !== canonical.toString()) {
                setSearchParams(canonical, { replace: true });
            }
        }, [query, searchParams, setSearchParams]);

        const patch = useCallback(
            (
                updates: ListQueryPatch<TQuery>,
                options: ListQueryPatchOptions = {},
            ) => {
                setSearchParams(
                    (current) => {
                        const previous = parseParams(
                            current,
                            config.schema,
                            config.readParams,
                            config.fields,
                        );
                        const next = applyPatch(previous, updates, options);

                        return config.serialize(next);
                    },
                    { replace: options.replace ?? false },
                );
            },
            [setSearchParams],
        );

        const setSearch = useCallback(
            (search: string) => {
                patch(
                    { search } as ListQueryPatch<TQuery>,
                    { replace: true, resetPage: true },
                );
            },
            [patch],
        );

        const setPage = useCallback(
            (page: number) => {
                patch({ page: Math.max(1, page) } as ListQueryPatch<TQuery>);
            },
            [patch],
        );

        const setLimit = useCallback(
            (limit: number) => {
                patch(
                    { limit: limit as TQuery["limit"] } as ListQueryPatch<TQuery>,
                    { replace: true, resetPage: true },
                );
            },
            [patch],
        );

        const handleSort = useCallback(
            (key: keyof TRow) => {
                if (
                    typeof key !== "string" ||
                    !config.isSortKey(key as keyof TRow & string)
                ) {
                    return;
                }

                patch(
                    nextSort(query, key, config.defaultSort) as ListQueryPatch<TQuery>,
                    { replace: true },
                );
            },
            [patch, query],
        );

        const sortConfig = tableSortConfig<TRow, TQuery>(
            query,
            config.defaultSort,
        );

        const tableState: TableStateProps<TRow> = {
            search: searchValue,
            filterId: config.getFilterId?.(query) ?? null,
            sortConfig,
            page: query.page,
            limit: query.limit,
        };

        const extra = useMemo(
            () => config.extra?.(patch) ?? ({} as TExtra),
            [patch],
        );

        return {
            query,
            apiQuery: config.debounceSearch
                ? ({ ...query, search: debouncedSearch } as TQuery)
                : query,
            tableState,
            sortConfig,
            setSearch,
            handleSort,
            setPage,
            setLimit,
            ...extra,
        };
    };

    return useListQuery;
};
