import { useState } from "react";
import {
    DUE_SOON_DAYS,
    berlinTodayIso,
    type DueKind,
    type DueListState,
} from "@fleet-live/shared";

import { useDueList } from "../../hooks/useDueList";
import { useDueListQuery } from "../../hooks/useDueListQuery";
import { formatCount } from "../../utils/formatCount";
import { Input } from "../ui/Input/Input";
import { RetryMessage } from "../ui/RetryMessage";
import { DueFullList, DueOverview } from "./DueLists";
import { DueRail } from "./DueRail";
import { dueSoonLabel } from "./dueLabels";
import styles from "./DueBoard.module.scss";

const STATE_TILES: Array<{ id: DueListState; hint: string }> = [
    { id: "overdue", hint: "zuerst: was abgelaufen ist" },
    { id: "soon", hint: "Vorlauf der Firma" },
    { id: "missing", hint: "Frist nicht prüfbar" },
];

/** Deadlines grouped by kind, with the rule of each kind beside the list. */
export const DueBoard = () => {
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

            <div className={styles.tiles} role="group" aria-label="Stand">
                {STATE_TILES.map((tile) => {
                    const active = query.state === tile.id;
                    const count = meta?.counts[tile.id];

                    return (
                        <button
                            key={tile.id}
                            type="button"
                            className={[
                                styles.tile,
                                styles[`tile_${tile.id}`],
                                active && styles.tileActive,
                            ]
                                .filter(Boolean)
                                .join(" ")}
                            aria-pressed={active}
                            onClick={() => setFilter(tile.id)}
                        >
                            <span>
                                <span className={styles.tileLabel}>
                                    {tileLabel(tile.id)}
                                </span>
                                <span className={styles.tileHint}>{tile.hint}</span>
                            </span>
                            <span className={styles.tileCount}>
                                {count === undefined ? "–" : formatCount(count)}
                            </span>
                        </button>
                    );
                })}
            </div>

            {summary.error && (
                <RetryMessage message={summary.error} onRetry={reload} />
            )}

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
