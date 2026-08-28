import { useEffect, useMemo, useRef, useState } from "react";
import { FLEET_DRIVERS_MAX, type FleetDriver } from "@fleet-live/shared";

import { isAbortError } from "../../api/client";
import { listDrivers } from "../../api/vehicles";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { formatCount } from "../../utils/formatCount";
import { Button } from "../ui/Button/Button";
import { Modal } from "../ui/Modal/Modal";
import styles from "./FleetDriverPicker.module.scss";

type FleetDriverPickerProps = {
    selected: string[];
    onChange: (names: string[]) => void;
};

const mergeKnown = (
    current: Map<string, string>,
    rows: FleetDriver[],
): Map<string, string> => {
    if (rows.length === 0) {
        return current;
    }

    const next = new Map(current);

    for (const row of rows) {
        next.set(row.name, row.license_plate);
    }

    return next;
};

export const FleetDriverPicker = ({
    selected,
    onChange,
}: FleetDriverPickerProps) => {
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

        listDrivers({}, controller.signal)
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

        listDrivers({ names }, controller.signal)
            .then((response) => {
                setKnown((current) => mergeKnown(current, response.data));
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

        listDrivers(
            { search: debouncedQuery, page },
            controller.signal,
        )
            .then((response) => {
                setHits(response.data);
                setMatched(response.meta.total);
                setPageCount(response.meta.pageCount);
                setKnown((current) => mergeKnown(current, response.data));
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

    const openModal = () => {
        setDraft(selected);
        setQuery("");
        setHits([]);
        setPage(1);
        setOpen(true);
    };

    const closeModal = () => {
        setOpen(false);
        setQuery("");
        setHits([]);
        setPage(1);
    };

    const toggle = (name: string) => {
        if (draft.includes(name)) {
            setDraft(draft.filter((item) => item !== name));
            return;
        }

        if (draft.length >= FLEET_DRIVERS_MAX) {
            return;
        }

        setDraft([...draft, name]);
    };

    const apply = () => {
        onChange(draft);
        closeModal();
    };

    const label =
        selected.length === 0
            ? "Fahrer wählen"
            : selected.length === 1
              ? selected[0]
              : `${formatCount(selected.length)} Fahrer`;
    const triggerLabel =
        selected.length === 0
            ? "Fahrer wählen"
            : selected.length === 1
              ? `Fahrer: ${selected[0]}`
              : `${formatCount(selected.length)} Fahrer ausgewählt`;
    const searching = query.trim().length > 0;
    const searchPending =
        searching && (isSearching || query.trim() !== debouncedQuery);
    const summary = searching
        ? searchPending
            ? "Suche…"
            : `${formatCount(matched)} Treffer`
        : draft.length > 0
          ? `${formatCount(draft.length)} ausgewählt`
          : rosterTotal > 0
            ? `${formatCount(rosterTotal)} Fahrer — Name oder Kennzeichen suchen.`
            : "Name oder Kennzeichen suchen.";

    return (
        <div className={styles.wrap}>
            <button
                type="button"
                className={styles.trigger}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={triggerLabel}
                data-filled={selected.length > 0 ? "true" : undefined}
                onClick={openModal}
            >
                <span className={styles.triggerText}>{label}</span>
                <span className={styles.caret} aria-hidden>
                    ▾
                </span>
            </button>

            <Modal
                open={open}
                onClose={closeModal}
                title="Fahrer auswählen"
                size="lg"
            >
                <div className={styles.modal}>
                    <div className={styles.toolbar}>
                        <input
                            ref={searchRef}
                            type="search"
                            className={styles.search}
                            placeholder="Name oder Kennzeichen"
                            aria-label="Name oder Kennzeichen"
                            value={query}
                            onChange={(event) => {
                                setQuery(event.target.value);
                                setPage(1);
                            }}
                        />
                        <p className={styles.summary}>
                            {summary}
                            {draft.length >= FLEET_DRIVERS_MAX
                                ? ` · höchstens ${FLEET_DRIVERS_MAX}`
                                : ""}
                        </p>
                    </div>

                    <ul ref={listRef} className={styles.list}>
                        {visible.map((driver) => {
                            const checked = draft.includes(driver.name);
                            const blocked =
                                !checked &&
                                draft.length >= FLEET_DRIVERS_MAX;

                            return (
                                <li key={`${driver.name}:${driver.license_plate}`}>
                                    <label
                                        className={
                                            checked
                                                ? `${styles.option} ${styles.optionChecked}`
                                                : styles.option
                                        }
                                    >
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            disabled={blocked}
                                            onChange={() =>
                                                toggle(driver.name)
                                            }
                                        />
                                        <span className={styles.name}>
                                            {driver.name}
                                        </span>
                                        <span className={styles.plate}>
                                            {driver.license_plate}
                                        </span>
                                    </label>
                                </li>
                            );
                        })}
                    </ul>
                    {searching &&
                        !searchPending &&
                        visible.length === 0 && (
                            <p className={styles.empty}>
                                Keine Fahrer gefunden.
                            </p>
                        )}
                    {!searching && draft.length === 0 && (
                        <p className={styles.empty}>
                            Ein Fahrer sitzt in einem Fahrzeug. Name
                            oder Kennzeichen eingeben, dann in der
                            Liste auswählen.
                        </p>
                    )}
                    <div className={styles.footer}>
                        <button
                            type="button"
                            className={styles.clear}
                            disabled={draft.length === 0}
                            onClick={() => setDraft([])}
                        >
                            Auswahl aufheben
                        </button>
                        {searching && !searchPending && pageCount > 1 && (
                            <div className={styles.pager}>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    disabled={page <= 1}
                                    onClick={() => setPage(page - 1)}
                                >
                                    Zurück
                                </Button>
                                <span>
                                    Seite {formatCount(page)} von{" "}
                                    {formatCount(pageCount)}
                                </span>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    disabled={page >= pageCount}
                                    onClick={() => setPage(page + 1)}
                                >
                                    Weiter
                                </Button>
                            </div>
                        )}
                        <div className={styles.actions}>
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={closeModal}
                            >
                                Abbrechen
                            </Button>
                            <Button
                                type="button"
                                variant="primary"
                                size="sm"
                                onClick={apply}
                            >
                                Übernehmen
                            </Button>
                        </div>
                    </div>
                </div>
            </Modal>
        </div>
    );
};
