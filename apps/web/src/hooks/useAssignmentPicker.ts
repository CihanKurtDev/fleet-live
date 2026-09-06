import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

import { ApiError, isAbortError } from "../api/client";
import { useVehicles } from "../context/vehiclesContext";

type ConfirmAssignContext = {
    autoCurrent: boolean;
    clearAutoCurrent: () => void;
    closePicker: () => void;
};

export type EntityAssignmentPickerConfig<TCandidate, TAssigned = never> = {
    mode: "entity";
    excludedIds?: Set<number>;
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

    const excludedIdsRef = useRef(excludedIds);
    excludedIdsRef.current = excludedIds;

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
                        return !excludedIdsRef.current.has(id);
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
    }, [assignOpen, search, fetchCandidates, candidatesLoadError]);

    useEffect(() => {
        if (!assignOpen) {
            return;
        }

        setCandidates((current) =>
            current.filter((row) => {
                const id = (row as { id: number }).id;
                return !excludedIdsRef.current.has(id);
            }),
        );
    }, [assignOpen, excludedIdsKey]);

    const openAssignPicker = useCallback(() => {
        setSearch("");
        setIsLoadingCandidates(true);
        autoCurrentRef.current = config.getAutoCurrentOnOpen();
        setAssignOpen(true);
    }, [config.getAutoCurrentOnOpen]);

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
