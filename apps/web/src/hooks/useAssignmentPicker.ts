import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

import { ApiError, isAbortError } from "../api/client";
import { useVehicles } from "../context/vehiclesContext";
import { useDebouncedValue } from "./useDebouncedValue";
import { useLatestRef } from "./useLatestRef";

export const ASSIGNMENT_PICKER_PAGE_SIZE = 25;

type ConfirmAssignContext = {
    autoCurrent: boolean;
    clearAutoCurrent: () => void;
    closePicker: () => void;
};

export type AssignmentCandidatePage<TCandidate> = {
    data: TCandidate[];
    page: number;
    pageCount: number;
    total: number;
};

export type EntityAssignmentPickerConfig<TCandidate, TAssigned = never> = {
    mode: "entity";
    excludedIds?: Set<number>;
    fetchCandidates: (
        search: string,
        page: number,
        signal: AbortSignal,
    ) => Promise<AssignmentCandidatePage<TCandidate>>;
    candidatesLoadError: string;
    mutationError: string;
    getAutoCurrentOnOpen: () => boolean;
    onConfirmAssign: (
        ids: number[],
        context: ConfirmAssignContext,
    ) => Promise<void>;
    assigned?: {
        deps: readonly unknown[];
        fetch: (signal: AbortSignal) => Promise<TAssigned[]>;
        errorMessage: string;
    };
};

type EntityAssignmentPickerResult<TCandidate, TAssigned> = {
    mode: "entity";
    error: string | null;
    busy: boolean;
    run: (action: () => Promise<unknown>) => Promise<void>;
    assignOpen: boolean;
    openAssignPicker: () => void;
    closeAssignPicker: () => void;
    search: string;
    setSearch: (value: string) => void;
    searchPending: boolean;
    page: number;
    pageCount: number;
    total: number;
    setPage: (page: number) => void;
    candidates: TCandidate[];
    isLoadingCandidates: boolean;
    confirmAssign: (ids: number[]) => void;
    assigned: TAssigned[];
};

export function useAssignmentPicker<TCandidate, TAssigned = never>(
    config: EntityAssignmentPickerConfig<TCandidate, TAssigned>,
): EntityAssignmentPickerResult<TCandidate, TAssigned> {
    const { refetchLists } = useVehicles();
    const [assigned, setAssigned] = useState<TAssigned[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [assignOpen, setAssignOpen] = useState(false);
    const [candidates, setCandidates] = useState<TCandidate[]>([]);
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [pageCount, setPageCount] = useState(1);
    const [total, setTotal] = useState(0);
    const [loadedKey, setLoadedKey] = useState<string | null>(null);
    const autoCurrentRef = useRef(false);
    const fetchGenerationRef = useRef(0);
    const debouncedSearch = useDebouncedValue(search, 250);
    const searchPending = assignOpen && search !== debouncedSearch;

    const mutationError = config.mutationError;
    const getAutoCurrentOnOpen = config.getAutoCurrentOnOpen;
    const onConfirmAssign = config.onConfirmAssign;

    const run = useCallback(
        async (action: () => Promise<unknown>) => {
            setBusy(true);
            setError(null);

            try {
                await action();
                refetchLists();
            } catch (caught) {
                setError(
                    caught instanceof ApiError
                        ? caught.message
                        : mutationError,
                );
            } finally {
                setBusy(false);
            }
        },
        [mutationError, refetchLists],
    );

    const {
        fetchCandidates,
        candidatesLoadError,
        excludedIds: externalExcludedIds,
        assigned: assignedConfig,
    } = config;

    const excludedIds = useMemo(() => {
        if (assignedConfig) {
            return new Set(
                assigned.map((row) => (row as { id: number }).id),
            );
        }

        return externalExcludedIds ?? new Set<number>();
    }, [assigned, assignedConfig, externalExcludedIds]);

    const excludedIdsKey = useMemo(() => {
        const ids = assignedConfig
            ? assigned.map((row) => (row as { id: number }).id)
            : [...(externalExcludedIds ?? [])];

        return ids.sort((left, right) => left - right).join(",");
    }, [assigned, assignedConfig, externalExcludedIds]);

    const excludedIdsRef = useLatestRef(excludedIds);

    const assignedDepsKey = assignedConfig
        ? assignedConfig.deps.map(String).join("\0")
        : "";
    const assignedFetch = assignedConfig?.fetch;
    const assignedErrorMessage = assignedConfig?.errorMessage;

    useEffect(() => {
        if (!assignedFetch) {
            return;
        }

        const controller = new AbortController();

        assignedFetch(controller.signal)
            .then((rows) => {
                setAssigned(rows);
            })
            .catch((caught: unknown) => {
                if (controller.signal.aborted || isAbortError(caught)) {
                    return;
                }

                setError(
                    caught instanceof Error
                        ? caught.message
                        : (assignedErrorMessage ??
                              "Zuweisung konnte nicht geladen werden."),
                );
            });

        return () => controller.abort();
    }, [assignedDepsKey, assignedErrorMessage, assignedFetch]);

    const [prevDebouncedSearch, setPrevDebouncedSearch] =
        useState(debouncedSearch);
    if (assignOpen && debouncedSearch !== prevDebouncedSearch) {
        setPrevDebouncedSearch(debouncedSearch);
        if (page !== 1) {
            setPage(1);
        }
    } else if (!assignOpen && debouncedSearch !== prevDebouncedSearch) {
        setPrevDebouncedSearch(debouncedSearch);
    }

    // Nur Suche/Seite triggern Voll-Laden — nicht excludedIds (sonst Scroll-Sprung).
    const candidatesRequestKey = assignOpen
        ? `${debouncedSearch}\0${page}`
        : null;
    const isLoadingCandidates =
        assignOpen &&
        candidatesRequestKey !== null &&
        candidatesRequestKey !== loadedKey;

    useEffect(() => {
        if (!assignOpen || candidatesRequestKey === null) {
            return;
        }

        const generation = ++fetchGenerationRef.current;
        const controller = new AbortController();

        fetchCandidates(debouncedSearch, page, controller.signal)
            .then((response) => {
                if (generation !== fetchGenerationRef.current) {
                    return;
                }

                setCandidates(
                    response.data.filter((row) => {
                        const id = (row as { id: number }).id;
                        return !excludedIdsRef.current.has(id);
                    }),
                );
                setPageCount(Math.max(1, response.pageCount));
                // total/pageCount nie zwischen Seiten auf 0 setzen — nur echte Antwort.
                setTotal(response.total);
                setLoadedKey(candidatesRequestKey);
            })
            .catch((caught: unknown) => {
                if (
                    generation !== fetchGenerationRef.current ||
                    controller.signal.aborted ||
                    isAbortError(caught)
                ) {
                    return;
                }

                setError(
                    caught instanceof Error
                        ? caught.message
                        : candidatesLoadError,
                );
                setLoadedKey(candidatesRequestKey);
            });

        return () => {
            controller.abort();
        };
    }, [
        assignOpen,
        candidatesRequestKey,
        debouncedSearch,
        page,
        fetchCandidates,
        candidatesLoadError,
        excludedIdsRef,
    ]);

    const [prevExcludedIdsKey, setPrevExcludedIdsKey] = useState(excludedIdsKey);
    if (assignOpen && excludedIdsKey !== prevExcludedIdsKey) {
        setPrevExcludedIdsKey(excludedIdsKey);
        setCandidates((current) =>
            current.filter((row) => {
                const id = (row as { id: number }).id;
                return !excludedIds.has(id);
            }),
        );
    } else if (excludedIdsKey !== prevExcludedIdsKey) {
        setPrevExcludedIdsKey(excludedIdsKey);
    }

    const resetCandidates = useCallback(() => {
        setCandidates([]);
        setPageCount(1);
        setTotal(0);
        setLoadedKey(null);
        setPage(1);
        setSearch("");
    }, []);

    const openAssignPicker = useCallback(() => {
        resetCandidates();
        autoCurrentRef.current = getAutoCurrentOnOpen();
        setAssignOpen(true);
    }, [getAutoCurrentOnOpen, resetCandidates]);

    const closeAssignPicker = useCallback(() => {
        setAssignOpen(false);
        resetCandidates();
    }, [resetCandidates]);

    const confirmAssign = useCallback(
        (ids: number[]) => {
            void run(async () => {
                await onConfirmAssign(ids, {
                    autoCurrent: autoCurrentRef.current,
                    clearAutoCurrent: () => {
                        autoCurrentRef.current = false;
                    },
                    closePicker: () => {
                        setAssignOpen(false);
                    },
                });
            });
        },
        [onConfirmAssign, run],
    );

    return {
        mode: "entity",
        error,
        busy,
        run,
        assignOpen,
        openAssignPicker,
        closeAssignPicker,
        search,
        setSearch,
        searchPending,
        page,
        pageCount,
        total,
        setPage,
        candidates,
        isLoadingCandidates,
        confirmAssign,
        assigned,
    };
}
