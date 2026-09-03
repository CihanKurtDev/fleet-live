import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type RefObject,
} from "react";
import { FLEET_DRIVERS_MAX, type FleetDriver } from "@fleet-live/shared";

import { ApiError, isAbortError } from "../api/client";
import { listDrivers as listFleetDrivers } from "../api/vehicles";
import { useVehicles } from "../context/vehiclesContext";
import { useDebouncedValue } from "./useDebouncedValue";

type ConfirmAssignContext = {
    autoCurrent: boolean;
    clearAutoCurrent: () => void;
    closePicker: () => void;
};

export type EntityAssignmentPickerConfig<TCandidate, TAssigned = never> = {
    mode: "entity";
    excludedIds?: Set<number>;
    excludedIdsDeps?: readonly unknown[];
    fetchCandidates: (
        search: string,
        signal: AbortSignal,
    ) => Promise<TCandidate[]>;
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

export type FleetAssignmentPickerConfig = {
    mode: "fleet-filter";
    selected: string[];
    onChange: (names: string[]) => void;
};

export type AssignmentPickerConfig<TCandidate, TAssigned = never> =
    | EntityAssignmentPickerConfig<TCandidate, TAssigned>
    | FleetAssignmentPickerConfig;

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
    candidates: TCandidate[];
    isLoadingCandidates: boolean;
    confirmAssign: (ids: number[]) => void;
    assigned: TAssigned[];
};

type FleetDriverVisible = Pick<FleetDriver, "name" | "license_plate">;

type FleetAssignmentPickerResult = {
    mode: "fleet-filter";
    open: boolean;
    openModal: () => void;
    closeModal: () => void;
    draft: string[];
    setDraft: (names: string[]) => void;
    query: string;
    setQuery: (value: string) => void;
    visible: FleetDriverVisible[];
    rosterTotal: number;
    matched: number;
    page: number;
    setPage: (page: number) => void;
    pageCount: number;
    isSearching: boolean;
    searchRef: RefObject<HTMLInputElement | null>;
    listRef: RefObject<HTMLUListElement | null>;
    debouncedQuery: string;
    searching: boolean;
    searchPending: boolean;
    toggle: (name: string) => void;
    apply: () => void;
};

const mergeKnownDrivers = (
    current: Map<string, string>,
    rows: FleetDriver[],
): Map<string, string> => {
    if (rows.length === 0) {
        return current;
    }

    const next = new Map(current);

    for (const row of rows) {
        next.set(row.name, row.license_plate ?? "");
    }

    return next;
};

function useEntityAssignmentPicker<TCandidate, TAssigned>(
    config: EntityAssignmentPickerConfig<TCandidate, TAssigned>,
): EntityAssignmentPickerResult<TCandidate, TAssigned> {
    const { refetchLists } = useVehicles();
    const [assigned, setAssigned] = useState<TAssigned[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [assignOpen, setAssignOpen] = useState(false);
    const [candidates, setCandidates] = useState<TCandidate[]>([]);
    const [search, setSearch] = useState("");
    const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
    const autoCurrentRef = useRef(false);

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
                        : config.mutationError,
                );
            } finally {
                setBusy(false);
            }
        },
        [config.mutationError, refetchLists],
    );

    const {
        fetchCandidates,
        candidatesLoadError,
        excludedIds: externalExcludedIds,
        excludedIdsDeps = [],
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

    const candidateReloadDeps = assignedConfig
        ? [assigned]
        : excludedIdsDeps;

    useEffect(() => {
        if (!assignedConfig) {
            return;
        }

        const controller = new AbortController();

        assignedConfig
            .fetch(controller.signal)
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
                        : assignedConfig.errorMessage,
                );
            });

        return () => controller.abort();
    }, [assignedConfig, ...(assignedConfig?.deps ?? [])]);

    useEffect(() => {
        if (!assignOpen) {
            return;
        }

        const controller = new AbortController();
        setIsLoadingCandidates(true);

        fetchCandidates(search, controller.signal)
            .then((rows) => {
                setCandidates(
                    rows.filter((row) => {
                        const id = (row as { id: number }).id;
                        return !excludedIds.has(id);
                    }),
                );
            })
            .catch((caught: unknown) => {
                if (controller.signal.aborted || isAbortError(caught)) {
                    return;
                }

                setError(
                    caught instanceof Error
                        ? caught.message
                        : candidatesLoadError,
                );
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setIsLoadingCandidates(false);
                }
            });

        return () => controller.abort();
    }, [
        assignOpen,
        search,
        fetchCandidates,
        candidatesLoadError,
        excludedIds,
        ...candidateReloadDeps,
    ]);

    const openAssignPicker = useCallback(() => {
        setSearch("");
        setIsLoadingCandidates(true);
        autoCurrentRef.current = config.getAutoCurrentOnOpen();
        setAssignOpen(true);
    }, [config]);

    const closeAssignPicker = useCallback(() => {
        setAssignOpen(false);
    }, []);

    const confirmAssign = useCallback(
        (ids: number[]) => {
            void run(async () => {
                await config.onConfirmAssign(ids, {
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
        [config, run],
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
        candidates,
        isLoadingCandidates,
        confirmAssign,
        assigned,
    };
}

function useFleetAssignmentPicker(
    config: FleetAssignmentPickerConfig,
): FleetAssignmentPickerResult {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<string[]>([]);
    const [query, setQuery] = useState("");
    const [hits, setHits] = useState<FleetDriver[]>([]);
    const [rosterTotal, setRosterTotal] = useState(0);
    const [matched, setMatched] = useState(0);
    const [page, setPage] = useState(1);
    const [pageCount, setPageCount] = useState(1);
    const [isSearching, setIsSearching] = useState(false);
    const [known, setKnown] = useState<Map<string, string>>(() => new Map());
    const searchRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);
    const debouncedQuery = useDebouncedValue(query.trim(), 250);

    useEffect(() => {
        if (open) {
            searchRef.current?.focus();
        }
    }, [open]);

    useEffect(() => {
        if (!open) {
            return;
        }

        const names = config.selected;
        const controller = new AbortController();

        listFleetDrivers({}, controller.signal)
            .then((response) => {
                setRosterTotal(response.meta.total);
            })
            .catch((caught: unknown) => {
                if (!controller.signal.aborted && !isAbortError(caught)) {
                    setRosterTotal(0);
                }
            });

        if (names.length === 0) {
            return () => controller.abort();
        }

        listFleetDrivers({ names }, controller.signal)
            .then((response) => {
                setKnown((current) => mergeKnownDrivers(current, response.data));
            })
            .catch((caught: unknown) => {
                if (controller.signal.aborted || isAbortError(caught)) {
                    return;
                }
            });

        return () => controller.abort();
    }, [open, config.selected]);

    useEffect(() => {
        if (!open) {
            return;
        }

        if (debouncedQuery.length === 0) {
            setHits([]);
            setMatched(0);
            setPageCount(1);
            setIsSearching(false);
            return;
        }

        const controller = new AbortController();
        setIsSearching(true);

        listFleetDrivers(
            { search: debouncedQuery, page },
            controller.signal,
        )
            .then((response) => {
                setHits(response.data);
                setMatched(response.meta.total);
                setPageCount(response.meta.pageCount);
                setKnown((current) => mergeKnownDrivers(current, response.data));
            })
            .catch((caught: unknown) => {
                if (!controller.signal.aborted && !isAbortError(caught)) {
                    setHits([]);
                    setMatched(0);
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setIsSearching(false);
                }
            });

        return () => controller.abort();
    }, [debouncedQuery, open, page]);

    useEffect(() => {
        listRef.current?.scrollTo(0, 0);
    }, [hits, page]);

    const visible = useMemo(() => {
        if (debouncedQuery.length > 0) {
            return hits;
        }

        return draft.flatMap((name) => {
            const plate = known.get(name);

            return plate ? [{ name, license_plate: plate }] : [];
        });
    }, [debouncedQuery, draft, hits, known]);

    const openModal = useCallback(() => {
        setDraft(config.selected);
        setQuery("");
        setHits([]);
        setPage(1);
        setOpen(true);
    }, [config.selected]);

    const closeModal = useCallback(() => {
        setOpen(false);
        setQuery("");
        setHits([]);
        setPage(1);
    }, []);

    const toggle = useCallback((name: string) => {
        setDraft((current) => {
            if (current.includes(name)) {
                return current.filter((item) => item !== name);
            }

            if (current.length >= FLEET_DRIVERS_MAX) {
                return current;
            }

            return [...current, name];
        });
    }, []);

    const apply = useCallback(() => {
        config.onChange(draft);
        closeModal();
    }, [closeModal, config, draft]);

    const searching = query.trim().length > 0;
    const searchPending =
        searching && (isSearching || query.trim() !== debouncedQuery);

    return {
        mode: "fleet-filter",
        open,
        openModal,
        closeModal,
        draft,
        setDraft,
        query,
        setQuery: (value: string) => {
            setQuery(value);
            setPage(1);
        },
        visible,
        rosterTotal,
        matched,
        page,
        setPage,
        pageCount,
        isSearching,
        searchRef,
        listRef,
        debouncedQuery,
        searching,
        searchPending,
        toggle,
        apply,
    };
}

export function useAssignmentPicker<TCandidate, TAssigned = never>(
    config: EntityAssignmentPickerConfig<TCandidate, TAssigned>,
): EntityAssignmentPickerResult<TCandidate, TAssigned>;
export function useAssignmentPicker(
    config: FleetAssignmentPickerConfig,
): FleetAssignmentPickerResult;
export function useAssignmentPicker<TCandidate, TAssigned>(
    config: AssignmentPickerConfig<TCandidate, TAssigned>,
):
    | EntityAssignmentPickerResult<TCandidate, TAssigned>
    | FleetAssignmentPickerResult {
    // mode is fixed for the lifetime of each caller
    if (config.mode === "fleet-filter") {
        // eslint-disable-next-line react-hooks/rules-of-hooks -- invariant mode per mount
        return useFleetAssignmentPicker(config);
    }

    // eslint-disable-next-line react-hooks/rules-of-hooks -- invariant mode per mount
    return useEntityAssignmentPicker(config);
}
