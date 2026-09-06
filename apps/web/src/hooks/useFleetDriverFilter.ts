import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { FLEET_DRIVERS_MAX, type FleetDriver } from "@fleet-live/shared";

import { isAbortError } from "../api/client";
import { listDrivers as listFleetDrivers } from "../api/vehicles";
import { useDebouncedValue } from "./useDebouncedValue";

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

type UseFleetDriverFilterArgs = {
    selected: string[];
    onChange: (names: string[]) => void;
};

export const useFleetDriverFilter = ({
    selected,
    onChange,
}: UseFleetDriverFilterArgs) => {
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

        const names = selected;
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
    }, [open, selected]);

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
        setDraft(selected);
        setQuery("");
        setHits([]);
        setPage(1);
        setOpen(true);
    }, [selected]);

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
        onChange(draft);
        closeModal();
    }, [closeModal, draft, onChange]);

    const searching = query.trim().length > 0;
    const searchPending =
        searching && (isSearching || query.trim() !== debouncedQuery);

    return {
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
};
