import { useState } from "react";
import {
    DUE_SOON_DAYS,
    berlinTodayIso,
    type DueKind,
    type DueListState,
} from "@fleet-live/shared";

import { useDueList } from "../../hooks/useDueList";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useDueListQuery } from "../../hooks/useDueListQuery";
import { Input } from "../ui/Input/Input";
import { KpiTiles, type KpiTileTone } from "../ui/KpiTiles/KpiTiles";
import { RetryMessage } from "../ui/RetryMessage";
import { DueFullList, DueOverview } from "./DueLists";
import { DueKindChips } from "./DueKindChips";
import { dueKindOptions } from "./dueView";
import { DueRail } from "./DueRail";
import { dueSoonLabel } from "./dueLabels";
import styles from "./DueBoard.module.scss";

/** Datum fehlt is not red (rules/ui-placement.md). */
const STATE_TILES: Array<{ id: DueListState; hint: string; tone: KpiTileTone }> = [
    { id: "overdue", hint: "zuerst: was abgelaufen ist", tone: "critical" },
    { id: "soon", hint: "Vorlauf der Firma", tone: "warning" },
    { id: "missing", hint: "Frist nicht prüfbar", tone: "neutral" },
];

/** Deadlines grouped by kind, with the rule of each kind beside the list. */
export const DueBoard = () => {
    usePageTitle("Fristen");
    const { query, apiQuery, tableState, setSearch, setFilter, setKind, setPage, setLimit } =
        useDueListQuery();
    const [reloadKey, setReloadKey] = useState(0);
    const summary = useDueList({ ...apiQuery, kind: undefined, page: 1, limit: 10 });
    const meta = summary.meta;
    const leadDays = meta?.lead_days ?? DUE_SOON_DAYS;
    const checkMonths = meta?.licence_check_months ?? 6;
    const today = berlinTodayIso();
    const activeKind: DueKind | null = query.kind ?? null;

    const reload = () => {
        summary.retry();
        setReloadKey((current) => current + 1);
    };

    const tileLabel = (id: DueListState) =>
        id === "soon" ? dueSoonLabel(leadDays) : id === "missing" ? "Datum fehlt" : "Überfällig";

    return (
        <section className={styles.page}>
            <header className={styles.head}>
                <div>
                    <h1 className={styles.title}>Fristen</h1>
                    <p className={styles.lead}>
                        Je Art eine Gruppe mit ihrer Regel, darin das Dringendste oben.
                    </p>
                </div>
                <Input
                    type="search"
                    size="sm"
                    className={styles.search}
                    placeholder="Kennzeichen oder Fahrer suchen..."
                    aria-label="Kennzeichen oder Fahrer suchen"
                    value={tableState.search}
                    onChange={(event) => setSearch(event.target.value)}
                />
            </header>

            {/* The same tiles as the list pages; data-tip anchors the page tip. */}
            <div data-tip="due-tiles">
                <KpiTiles
                    ariaLabel="Stand"
                    phoneLayout="strip"
                    tiles={STATE_TILES.map((tile) => ({
                        key: tile.id,
                        label: tileLabel(tile.id),
                        value: meta?.counts[tile.id] ?? null,
                        hint: tile.hint,
                        tone: tile.tone,
                        pressed: query.state === tile.id,
                        onToggle: () => setFilter(tile.id),
                    }))}
                />
            </div>

            {summary.error && (
                <RetryMessage message={summary.error} onRetry={reload} />
            )}

            <DueKindChips
                kinds={dueKindOptions(meta?.kind_counts, checkMonths)}
                activeKind={activeKind}
                onKind={(kind) => setKind(kind)}
            />

            <div className={styles.body}>
                <DueRail
                    activeKind={activeKind}
                    counts={meta?.kind_counts}
                    checkMonths={checkMonths}
                    onKind={(kind) => setKind(kind)}
                    onSaved={reload}
                />

                {activeKind ? (
                    <DueFullList
                        key={`${activeKind}:${reloadKey}`}
                        kind={activeKind}
                        query={apiQuery}
                        today={today}
                        checkMonths={checkMonths}
                        onPageChange={setPage}
                        onLimitChange={setLimit}
                    />
                ) : (
                    <DueOverview
                        key={reloadKey}
                        query={apiQuery}
                        today={today}
                        checkMonths={checkMonths}
                        onShowAll={(kind) => setKind(kind)}
                    />
                )}
            </div>
        </section>
    );
};
