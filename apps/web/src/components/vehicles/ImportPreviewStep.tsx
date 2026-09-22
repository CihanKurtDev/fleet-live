import { useCallback, useEffect, useRef, useState } from "react";
import {
    IMPORT_SHEET_KIND_LABELS,
    IMPORT_SHEET_KINDS,
    importActionKey,
    importCommitButtonLabel,
    importCommitDisableMessage,
    type ImportPreviewOutcome,
    type ImportPreviewResponse,
    type ImportPreviewRowStatusFilter,
    type ImportRowAction,
    type ImportSheetKind,
} from "@fleet-live/shared";

import {
    listImportPreviewRows,
    markImportExistingUpdate,
    patchImportPreviewActions,
} from "../../api/import";
import { ApiError } from "../../api/client";
import { Button } from "../ui/Button/Button";
import { Checkbox } from "../ui/Checkbox/Checkbox";
import { Table } from "../ui/Table/Table";
import { Avatar } from "../ui/Avatar/Avatar";
import {
    previewTableRow,
    unifiedImportPreviewColumns,
    type ImportPreviewTableRow,
} from "./importPreviewConfig";
import tableStyles from "../ui/Table/Table.module.scss";
import styles from "./ImportPreviewStep.module.scss";

const ROW_LIST_THRESHOLD = 3;
const ROWS_PAGE_SIZE = 50;

const STATUS_FILTER_LABELS: Record<ImportPreviewRowStatusFilter, string> = {
    all: "Alle",
    ready: "Übernehmen",
    already: "Schon da",
    deferred: "Manuell später",
    blocked: "Fehler",
};

function AggregateRows({
    examples,
    total,
    onViewAll,
}: {
    examples: string[];
    total: number;
    onViewAll: () => void;
}) {
    const remaining = Math.max(0, total - examples.length);

    return (
        <div className={styles.aggregateRows}>
            <div className={styles.aggregateExamples}>
                {examples.map((label) => (
                    <span key={label} className={styles.examplePill}>
                        {label}
                    </span>
                ))}
                {remaining > 0 ? (
                    <span
                        className={`${styles.examplePill} ${styles.examplePillMore}`}
                    >
                        + {remaining.toLocaleString("de-DE")} weitere
                    </span>
                ) : null}
            </div>
            <Button variant="secondary" size="sm" onClick={onViewAll}>
                Alle ansehen
            </Button>
        </div>
    );
}

function DeferredPersonCard({
    name,
    detail,
}: {
    name: string;
    detail: string;
}) {
    return (
        <div className={styles.personCard}>
            <Avatar name={name} size="sm" />
            <div className={styles.personCardBody}>
                <p className={styles.personCardName}>{name}</p>
                <p className={styles.personCardDetail}>{detail}</p>
            </div>
            <span className={styles.personCardBadge}>Unterwegs</span>
        </div>
    );
}

type ImportPreviewStepProps = {
    preview: ImportPreviewResponse;
    outcome: ImportPreviewOutcome;
    saveProfile: boolean;
    isLoading: boolean;
    onOutcomeChange: (outcome: ImportPreviewOutcome) => void;
    onSaveProfileChange: (value: boolean) => void;
    onBack: () => void;
    onCommit: (rowActions: Record<string, ImportRowAction>) => void;
    onError: (message: string) => void;
};

export function ImportPreviewStep({
    preview,
    outcome,
    saveProfile,
    isLoading,
    onOutcomeChange,
    onSaveProfileChange,
    onBack,
    onCommit,
    onError,
}: ImportPreviewStepProps) {
    const [rowSearch, setRowSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [rowStatusFilter, setRowStatusFilter] =
        useState<ImportPreviewRowStatusFilter>("all");
    const [sheetFilter, setSheetFilter] = useState<ImportSheetKind | null>(
        null,
    );
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [rows, setRows] = useState<ImportPreviewTableRow[]>([]);
    const [rowsTotal, setRowsTotal] = useState(0);
    const [sheetCounts, setSheetCounts] = useState<
        Partial<Record<ImportSheetKind, number>>
    >({});
    const [statusCounts, setStatusCounts] = useState<
        Record<ImportPreviewRowStatusFilter, number>
    >({
        all: 0,
        ready: 0,
        already: 0,
        deferred: 0,
        blocked: 0,
    });
    const [visibleLimit, setVisibleLimit] = useState(ROWS_PAGE_SIZE);
    const [rowsLoading, setRowsLoading] = useState(false);
    const [rowActions, setRowActions] = useState<
        Record<string, ImportRowAction>
    >({});
    const detailsRef = useRef<HTMLDetailsElement>(null);

    useEffect(() => {
        const id = window.setTimeout(() => {
            setDebouncedSearch(rowSearch.trim());
        }, 250);
        return () => window.clearTimeout(id);
    }, [rowSearch]);

    const loadRows = useCallback(
        async (limit: number) => {
            setRowsLoading(true);
            try {
                const response = await listImportPreviewRows(
                    preview.preview_id,
                    {
                        page: 1,
                        limit,
                        sheet_kind: sheetFilter ?? undefined,
                        status: rowStatusFilter,
                        q: debouncedSearch,
                    },
                );

                setRows(
                    response.data.map((row) =>
                        previewTableRow(row, row.action),
                    ),
                );
                setRowsTotal(response.meta.total);
                setSheetCounts(response.meta.sheet_counts);
                setStatusCounts(response.meta.status_counts);
            } catch (caught) {
                onError(
                    caught instanceof ApiError
                        ? caught.message
                        : "Zeilen konnten nicht geladen werden.",
                );
            } finally {
                setRowsLoading(false);
            }
        },
        [
            preview.preview_id,
            sheetFilter,
            rowStatusFilter,
            debouncedSearch,
            onError,
        ],
    );

    const rowsRequestKey = detailsOpen
        ? [
              preview.preview_id,
              sheetFilter ?? "",
              rowStatusFilter,
              debouncedSearch,
              visibleLimit,
          ].join("\0")
        : null;
    const [prevRowsRequestKey, setPrevRowsRequestKey] = useState(rowsRequestKey);

    if (rowsRequestKey !== prevRowsRequestKey) {
        setPrevRowsRequestKey(rowsRequestKey);
        if (rowsRequestKey !== null) {
            setRowsLoading(true);
        } else {
            setRowsLoading(false);
        }
    }

    useEffect(() => {
        if (!detailsOpen) {
            return;
        }

        const controller = new AbortController();

        void (async () => {
            try {
                const response = await listImportPreviewRows(
                    preview.preview_id,
                    {
                        page: 1,
                        limit: visibleLimit,
                        sheet_kind: sheetFilter ?? undefined,
                        status: rowStatusFilter,
                        q: debouncedSearch,
                    },
                );

                if (controller.signal.aborted) {
                    return;
                }

                setRows(
                    response.data.map((row) =>
                        previewTableRow(row, row.action),
                    ),
                );
                setRowsTotal(response.meta.total);
                setSheetCounts(response.meta.sheet_counts);
                setStatusCounts(response.meta.status_counts);
            } catch (caught) {
                if (controller.signal.aborted) {
                    return;
                }

                onError(
                    caught instanceof ApiError
                        ? caught.message
                        : "Zeilen konnten nicht geladen werden.",
                );
            } finally {
                if (!controller.signal.aborted) {
                    setRowsLoading(false);
                }
            }
        })();

        return () => controller.abort();
    }, [
        detailsOpen,
        visibleLimit,
        preview.preview_id,
        sheetFilter,
        rowStatusFilter,
        debouncedSearch,
        onError,
    ]);

    const handleViewRows = useCallback(
        (filter: ImportPreviewRowStatusFilter) => {
            setRowStatusFilter(filter);
            if (filter === "deferred") {
                setSheetFilter("current");
            }
            setVisibleLimit(ROWS_PAGE_SIZE);
            setDetailsOpen(true);
            requestAnimationFrame(() => {
                detailsRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                });
            });
        },
        [],
    );

    const handleActionChange = async (
        row: ImportPreviewTableRow,
        action: ImportRowAction,
    ) => {
        const key = importActionKey(row.sheet_kind, row.row_index);
        const next = { ...rowActions, [key]: action };
        setRowActions(next);
        setRows((current) =>
            current.map((item) =>
                importActionKey(item.sheet_kind, item.row_index) === key
                    ? previewTableRow(item, action)
                    : item,
            ),
        );

        try {
            const response = await patchImportPreviewActions(
                preview.preview_id,
                { [key]: action },
            );
            onOutcomeChange(response.data);
        } catch (caught) {
            onError(
                caught instanceof ApiError
                    ? caught.message
                    : "Aktion konnte nicht gespeichert werden.",
            );
        }
    };

    const handleMarkExisting = async () => {
        try {
            const response = await markImportExistingUpdate(preview.preview_id);
            onOutcomeChange(response.data);
            setRowActions({});
            if (detailsOpen) {
                void loadRows(visibleLimit);
            }
        } catch (caught) {
            onError(
                caught instanceof ApiError
                    ? caught.message
                    : "Aktualisieren fehlgeschlagen.",
            );
        }
    };

    const showNothingNew =
        !outcome.can_commit &&
        outcome.disable_reason === "all_skipped" &&
        outcome.already_there_count > 0;
    const showNothingMarked =
        !outcome.can_commit &&
        outcome.disable_reason === "all_skipped" &&
        outcome.already_there_count === 0;
    const showBlockedBanner =
        !outcome.can_commit &&
        (outcome.disable_reason === "only_errors" ||
            outcome.disable_reason === "mixed_no_ready");

    const commitDisableMessage = importCommitDisableMessage({
        readyCount: outcome.ready_count,
        blockedCount: outcome.blocked_count,
        deferredCount: outcome.deferred_count,
        skippedCount: outcome.skipped_count,
        alreadyThereCount: outcome.already_there_count,
        blockedRows: [],
        deferredRows: [],
        canCommit: outcome.can_commit,
        disableReason: outcome.disable_reason,
    });

    const commitButtonLabel = importCommitButtonLabel(outcome.ready_count);
    const sheetTotal = Object.values(sheetCounts).reduce(
        (sum, value) => sum + (value ?? 0),
        0,
    );

    return (
        <section className={styles.previewPanel}>
            <h2 className={styles.previewTitle}>Prüfung</h2>
            <p className={styles.previewLead}>
                Datei gegen den Bestand geprüft. Zahlen zuerst, einzelne Zeilen
                nur bei Bedarf.
            </p>

            <div className={styles.kpiGrid}>
                <article className={styles.kpiCard}>
                    <div className={styles.kpiIcon} aria-hidden>
                        +
                    </div>
                    <p className={styles.kpiLabel}>Übernehmen</p>
                    <p className={styles.kpiValue}>
                        {outcome.ready_count.toLocaleString("de-DE")}
                    </p>
                    <p className={styles.kpiHint}>
                        Neue Datensätze werden angelegt
                    </p>
                </article>
                <article className={styles.kpiCard}>
                    <div className={styles.kpiIcon} aria-hidden>
                        ✓
                    </div>
                    <p className={styles.kpiLabel}>Schon da</p>
                    <p className={styles.kpiValue}>
                        {outcome.already_there_count.toLocaleString("de-DE")}
                    </p>
                    <p className={styles.kpiHint}>
                        Stimmen mit dem Bestand überein
                    </p>
                </article>
                <article
                    className={
                        outcome.deferred_count > 0
                            ? `${styles.kpiCard} ${styles.kpiCardCaution}`
                            : styles.kpiCard
                    }
                >
                    <div
                        className={`${styles.kpiIcon} ${styles.kpiIconCaution}`}
                        aria-hidden
                    >
                        ⏱
                    </div>
                    <p className={styles.kpiLabel}>Manuell später</p>
                    <p className={styles.kpiValue}>
                        {outcome.deferred_count.toLocaleString("de-DE")}
                    </p>
                    <p className={styles.kpiHint}>
                        Fahrer unterwegs, Zuweisung selbst setzen
                    </p>
                </article>
                <article
                    className={
                        outcome.blocked_count > 0
                            ? `${styles.kpiCard} ${styles.kpiCardDanger}`
                            : styles.kpiCard
                    }
                >
                    <div
                        className={`${styles.kpiIcon} ${styles.kpiIconDanger}`}
                        aria-hidden
                    >
                        !
                    </div>
                    <p className={styles.kpiLabel}>Fehler</p>
                    <p className={styles.kpiValue}>
                        {outcome.blocked_count.toLocaleString("de-DE")}
                    </p>
                    <p className={styles.kpiHint}>
                        Werden beim Import übersprungen
                    </p>
                </article>
            </div>

            {showNothingNew || showNothingMarked || showBlockedBanner ? (
                <div
                    className={
                        showBlockedBanner
                            ? `${styles.statusPanel} ${styles.statusPanelDanger}`
                            : `${styles.statusPanel} ${styles.statusPanelSuccess}`
                    }
                    role={showBlockedBanner ? "alert" : "status"}
                >
                    <p className={styles.statusPanelTitle}>
                        {showBlockedBanner
                            ? "Import nicht möglich"
                            : showNothingNew
                              ? "Nichts Neues"
                              : "Nichts zu übernehmen"}
                    </p>
                    <p className={styles.statusPanelBody}>
                        {showNothingNew
                            ? "Alles schon im Bestand. Besatzung unten nach der Fahrt selbst setzen, nicht automatisch."
                            : (commitDisableMessage ??
                              "Keine Zeile ist zum Import markiert.")}
                    </p>
                    {showNothingNew ? (
                        <div className={styles.statusPanelFooter}>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => void handleMarkExisting()}
                            >
                                Vorhandene aktualisieren
                            </Button>
                            <p className={styles.statusPanelFootnote}>
                                Setzt wiedererkannte Zeilen auf „Aktualisieren“
                                (z. B. Telefon, Standort, HU). Fahrer auf Fahrt
                                und Fehlerzeilen bleiben unverändert.
                            </p>
                        </div>
                    ) : null}
                </div>
            ) : null}

            {outcome.deferred_count > 0 ? (
                <div
                    className={`${styles.statusPanel} ${styles.statusPanelCaution}`}
                >
                    <p className={styles.statusPanelTitle}>Manuell später</p>
                    <p className={styles.statusPanelBody}>
                        {outcome.deferred_count === 1
                            ? "1 Fahrer ist aktuell unterwegs. Die neue Zuweisung setzt du nach der Fahrt selbst, nicht automatisch."
                            : `${outcome.deferred_count.toLocaleString("de-DE")} Fahrer sind aktuell unterwegs. Die neue Zuweisung setzt du nach der Fahrt selbst, nicht automatisch.`}
                    </p>
                    {outcome.deferred_count <= ROW_LIST_THRESHOLD &&
                    outcome.deferred_examples.length > 0 ? (
                        <div className={styles.personCardList}>
                            {outcome.deferred_examples.map((label) => (
                                <DeferredPersonCard
                                    key={label}
                                    name={label.split(" · ")[0] ?? label}
                                    detail={`Neue Zuweisung wartet auf Fahrtende. ${label.includes(" · ") ? `Ziel ${label.split(" · ")[1]}.` : ""}`}
                                />
                            ))}
                        </div>
                    ) : (
                        <AggregateRows
                            examples={outcome.deferred_examples}
                            total={outcome.deferred_count}
                            onViewAll={() => handleViewRows("deferred")}
                        />
                    )}
                </div>
            ) : null}

            {outcome.blocked_count > 0 ? (
                <div
                    className={`${styles.statusPanel} ${styles.statusPanelDanger}`}
                >
                    <p className={styles.statusPanelTitle}>Fehler</p>
                    <p className={styles.statusPanelBody}>
                        {outcome.blocked_count === 1
                            ? "1 Zeile enthält Fehler und wird beim Import übersprungen."
                            : `${outcome.blocked_count.toLocaleString("de-DE")} Zeilen enthalten Fehler und werden beim Import übersprungen.`}
                    </p>
                    <AggregateRows
                        examples={outcome.blocked_examples}
                        total={outcome.blocked_count}
                        onViewAll={() => handleViewRows("blocked")}
                    />
                </div>
            ) : null}

            <label className={styles.remember}>
                <Checkbox
                    checked={saveProfile}
                    onChange={(event) =>
                        onSaveProfileChange(event.target.checked)
                    }
                />
                Als Firmenprofil merken
            </label>

            <div className={styles.previewActions}>
                <Button variant="secondary" size="sm" onClick={onBack}>
                    Zurück
                </Button>
                <Button
                    variant="primary"
                    size="sm"
                    disabled={isLoading || !outcome.can_commit}
                    onClick={() => onCommit(rowActions)}
                >
                    {isLoading ? "Import läuft…" : commitButtonLabel}
                </Button>
            </div>

            <details
                className={styles.rowDetails}
                ref={detailsRef}
                open={detailsOpen}
                onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
            >
                <summary className={styles.rowDetailsSummary}>
                    Zeilen ansehen und Aktionen ändern
                </summary>

                <div className={styles.tableToolbar}>
                    <input
                        type="search"
                        className={styles.searchInput}
                        placeholder="Fahrer oder Kennzeichen suchen…"
                        value={rowSearch}
                        onChange={(event) => {
                            setRowSearch(event.target.value);
                            setVisibleLimit(ROWS_PAGE_SIZE);
                        }}
                        aria-label="Zeilen durchsuchen"
                    />
                </div>

                <div className={styles.filterRow} role="group" aria-label="Blatt">
                    <button
                        type="button"
                        className={
                            sheetFilter === null
                                ? `${styles.filterChip} ${styles.filterChipActive}`
                                : styles.filterChip
                        }
                        onClick={() => {
                            setSheetFilter(null);
                            setVisibleLimit(ROWS_PAGE_SIZE);
                        }}
                    >
                        Alle Blätter
                        <span className={styles.filterChipCount}>
                            {sheetTotal.toLocaleString("de-DE")}
                        </span>
                    </button>
                    {IMPORT_SHEET_KINDS.map((kind) => {
                        const count = sheetCounts[kind] ?? 0;
                        if (count === 0 && sheetFilter !== kind) {
                            return null;
                        }

                        return (
                            <button
                                key={kind}
                                type="button"
                                className={
                                    sheetFilter === kind
                                        ? `${styles.filterChip} ${styles.filterChipActive}`
                                        : styles.filterChip
                                }
                                onClick={() => {
                                    setSheetFilter(kind);
                                    setVisibleLimit(ROWS_PAGE_SIZE);
                                }}
                            >
                                {IMPORT_SHEET_KIND_LABELS[kind]}
                                <span className={styles.filterChipCount}>
                                    {count.toLocaleString("de-DE")}
                                </span>
                            </button>
                        );
                    })}
                </div>

                <div
                    className={styles.filterRow}
                    role="group"
                    aria-label="Status"
                >
                    {(
                        Object.keys(
                            STATUS_FILTER_LABELS,
                        ) as ImportPreviewRowStatusFilter[]
                    ).map((key) => (
                        <button
                            key={key}
                            type="button"
                            className={
                                rowStatusFilter === key
                                    ? `${styles.filterChip} ${styles.filterChipActive}`
                                    : styles.filterChip
                            }
                            onClick={() => {
                                setRowStatusFilter(key);
                                setVisibleLimit(ROWS_PAGE_SIZE);
                            }}
                        >
                            {STATUS_FILTER_LABELS[key]}
                            <span className={styles.filterChipCount}>
                                {statusCounts[key].toLocaleString("de-DE")}
                            </span>
                        </button>
                    ))}
                </div>

                <Table
                    columns={unifiedImportPreviewColumns((row, action) => {
                        void handleActionChange(row, action);
                    })}
                    rows={rows}
                    getRowKey={(row) =>
                        importActionKey(row.sheet_kind, row.row_index)
                    }
                    getRowClassName={(row) => {
                        if (row.outcome.status === "blocked") {
                            return tableStyles.tableRowError;
                        }
                        if (row.outcome.status === "deferred") {
                            return tableStyles.tableRowDeferred;
                        }
                        return undefined;
                    }}
                    caption="Import-Zeilen"
                    isLoading={rowsLoading}
                    emptyContent="Keine Zeilen für diesen Filter."
                    className={styles.tableWrap}
                />

                {rowsTotal > visibleLimit ? (
                    <div className={styles.loadMoreRow}>
                        <span>
                            {visibleLimit.toLocaleString("de-DE")} von{" "}
                            {rowsTotal.toLocaleString("de-DE")} Zeilen
                        </span>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                                setVisibleLimit((current) => {
                                    if (current < 100) {
                                        return 100;
                                    }
                                    if (current < 200) {
                                        return 200;
                                    }
                                    return 500;
                                })
                            }
                        >
                            Weitere{" "}
                            {Math.min(
                                ROWS_PAGE_SIZE,
                                rowsTotal - visibleLimit,
                            ).toLocaleString("de-DE")}{" "}
                            laden
                        </Button>
                    </div>
                ) : null}
            </details>
        </section>
    );
}

