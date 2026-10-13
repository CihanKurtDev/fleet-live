import { useEffect, useState } from "react";
import type { DueListQuery, DueListResponse } from "@fleet-live/shared";
import { isAbortError } from "../api/client";
import { listDue } from "../api/due";
import { retryTransient } from "../api/retryTransient";
import { useRetryTrigger } from "./useRetryTrigger";

export const useDueList = (query: DueListQuery) => {
    const { retryKey, retry } = useRetryTrigger();
    const { state, kind, search, sort, dir, page, limit } = query;
    const [response, setResponse] = useState<DueListResponse | null>(null);
    const [isFetching, setIsFetching] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const requestKey = [
        state,
        kind,
        search,
        sort,
        dir,
        page,
        limit,
        retryKey,
    ].join("\0");
    const [fetchKey, setFetchKey] = useState(requestKey);

    if (requestKey !== fetchKey) {
        setFetchKey(requestKey);
        setIsFetching(true);
        setError(null);
    }

    useEffect(() => {
        const controller = new AbortController();
        const activeQuery: DueListQuery = {
            state,
            kind,
            search,
            sort,
            dir,
            page,
            limit,
        };

        retryTransient(() => listDue(activeQuery, controller.signal), controller.signal)
            .then((data) => {
                setResponse(data);
                setError(null);
            })
            .catch((caught: unknown) => {
                if (controller.signal.aborted || isAbortError(caught)) {
                    return;
                }

                setError(
                    caught instanceof Error
                        ? caught.message
                        : "Fristen konnten nicht geladen werden.",
                );
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setIsFetching(false);
                }
            });

        return () => controller.abort();
    }, [state, kind, search, sort, dir, page, limit, retryKey]);

    return {
        data: response?.data ?? [],
        meta: response?.meta,
        isLoading: response === null && isFetching,
        isFetching,
        error,
        retry,
        pageCount: response?.meta.pageCount ?? 1,
        total: response?.meta.total ?? 0,
    };
};
