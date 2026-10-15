import type { ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import {
    DRIVER_TALK_MIN_OPEN_WARNINGS,
    type DriverListQuery,
    type DueListQuery,
} from "@fleet-live/shared";

import { useBoundHeight } from "../../hooks/useBoundHeight";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useDriverList } from "../../hooks/useDriverList";
import { useDueList } from "../../hooks/useDueList";
import { formatTimestamp } from "../../utils/dateTime";
import { formatCount } from "../../utils/formatCount";
import { Button } from "../ui/Button/Button";
import { Input } from "../ui/Input/Input";
import { RetryMessage } from "../ui/RetryMessage";
import {
    DRIVER_BOARD_LIMIT,
    LICENCE_GROUPS,
    boardRowCount,
    driverAlertsPath,
    driverListPath,
    duePath,
    eligibilityText,
    licenceStateText,
    talkListPath,
    withoutVehicleListPath,
} from "./driverBoardView";
import styles from "./DriverBoard.module.scss";

type Tone = "danger" | "warning" | "neutral";

interface ColumnProps {
    tone: Tone;
    title: string;
    count: number | null;
    rule: string;
    isLoading: boolean;
    error: string | null;
    onRetry: () => void;
    empty: string;
    rows: ReactNode[];
    footer: ReactNode;
}

/** One column: head, as many rows as fit, footer link. */
const BoardColumn = ({
    tone,
    title,
    count,
    rule,
    isLoading,
    error,
    onRetry,
    empty,
    rows,
    footer,
}: ColumnProps) => {
    const { ref, height } = useBoundHeight<HTMLUListElement>();
    const visible = rows.slice(0, boardRowCount(height));

    return (
        <section
            className={`${styles.column} ${styles[`column_${tone}`]}`}
            aria-label={title}
        >
            <header className={styles.columnHead}>
                <h2 className={styles.columnTitle}>
                    {title}
                    {count !== null && (
                        <span className={`${styles.count} ${styles[`count_${tone}`]}`}>
                            {formatCount(count)}
                        </span>
                    )}
                </h2>
                <p className={styles.rule}>{rule}</p>
            </header>

            <ul ref={ref} className={styles.rows}>
                {error ? (
                    <li className={styles.message}>
                        <RetryMessage message={error} onRetry={onRetry} />
                    </li>
                ) : isLoading ? (
                    <li className={styles.message} aria-live="polite">
                        Wird geladen…
                    </li>
                ) : rows.length === 0 ? (
                    <li className={`${styles.message} ${styles.calm}`}>{empty}</li>
                ) : (
                    visible
                )}
            </ul>

            {footer && <footer className={styles.columnFoot}>{footer}</footer>}
        </section>
    );
};

const driverState = (pathname: string, search: string) => ({
    from: `${pathname}${search}`,
});

interface DriverBoardProps {
    onAddDriver?: () => void;
}

/** `/drivers`: who needs something today, in three columns. */
export const DriverBoard = ({ onAddDriver }: DriverBoardProps) => {
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();
    const searchInput = searchParams.get("search") ?? "";
    const search = useDebouncedValue(searchInput.trim());
    const from = driverState(location.pathname, location.search);

    const driverBase: DriverListQuery = {
        search,
        page: 1,
        limit: DRIVER_BOARD_LIMIT,
        dir: "asc",
    };
    const all = useDriverList({ ...driverBase, limit: 10 });
    const talk = useDriverList({
        ...driverBase,
        min_open_warnings: DRIVER_TALK_MIN_OPEN_WARNINGS,
    });
    const without = useDriverList({ ...driverBase, without_vehicle: true });

    const dueBase: Omit<DueListQuery, "state" | "kind"> = {
        search,
        sort: "due_on",
        dir: "asc",
        page: 1,
        limit: DRIVER_BOARD_LIMIT,
    };
    const licence = {
        expired: useDueList({ ...dueBase, state: "overdue", kind: "licence_expiry" }),
        check: useDueList({ ...dueBase, state: "overdue", kind: "licence_check" }),
        missing: useDueList({ ...dueBase, state: "missing", kind: "licence_expiry" }),
        soon: useDueList({ ...dueBase, state: "soon", kind: "licence_expiry" }),
    } satisfies Record<(typeof LICENCE_GROUPS)[number]["id"], ReturnType<typeof useDueList>>;
    const licenceLists = LICENCE_GROUPS.map((group) => ({
        group,
        list: licence[group.id as keyof typeof licence],
    }));
    const licenceLoading = licenceLists.some(({ list }) => list.isLoading);
    const licenceError =
        licenceLists.find(({ list }) => list.error)?.list.error ?? null;
    const licenceTotal = licenceLists.reduce(
        (sum, { list }) => sum + list.total,
        0,
    );
    const licenceRows = licenceLists.flatMap(({ list }) =>
        list.data.filter((row) => row.driver_id !== null),
    );

    const setSearch = (value: string) => {
        setSearchParams(value ? { search: value } : {}, { replace: true });
    };
    const searchEmpty = (fallback: string) =>
        search ? "Keine Treffer für die Suche." : fallback;

    return (
        <section className={styles.page}>
            <header className={styles.head}>
                <div className={styles.heading}>
                    <h1 className={styles.title}>Fahrer</h1>
                    <p className={styles.lead}>Wer braucht heute etwas von dir?</p>
                </div>
                <div className={styles.actions}>
                    <Input
                        type="search"
                        size="sm"
                        className={styles.search}
                        placeholder="Fahrer suchen..."
                        aria-label="Fahrer suchen"
                        maxLength={100}
                        value={searchInput}
                        onChange={(event) => setSearch(event.target.value)}
                    />
                    <Link className={styles.listLink} to={driverListPath(search)}>
                        {all.isLoading
                            ? "Alle als Liste"
                            : `Alle ${formatCount(all.total)} als Liste`}
                    </Link>
                    {onAddDriver && (
                        <Button size="sm" onClick={onAddDriver}>
                            Neuer Fahrer
                        </Button>
                    )}
                </div>
            </header>

            <div className={styles.columns}>
                <BoardColumn
                    tone="danger"
                    title="Gespräch führen"
                    count={talk.isLoading ? null : talk.total}
                    rule={`${DRIVER_TALK_MIN_OPEN_WARNINGS} oder mehr offene Tempo-Warnungen`}
                    isLoading={talk.isLoading}
                    error={talk.error}
                    onRetry={talk.retry}
                    empty={searchEmpty(
                        `Niemand hat ${DRIVER_TALK_MIN_OPEN_WARNINGS} oder mehr offene Warnungen.`,
                    )}
                    rows={talk.data.map((driver) => (
                        <li key={driver.id} className={styles.row}>
                            <span className={styles.who}>
                                <Link
                                    className={styles.name}
                                    to={`/drivers/${driver.id}`}
                                    state={from}
                                >
                                    {driver.name}
                                </Link>
                                <span className={styles.meta}>
                                    {[
                                        driver.current_vehicle_plate ?? "kein Fahrzeug",
                                        driver.last_warning_at
                                            ? `zuletzt ${formatTimestamp(driver.last_warning_at)}`
                                            : null,
                                    ]
                                        .filter(Boolean)
                                        .join(" · ")}
                                </span>
                            </span>
                            <span className={styles.side}>
                                <span
                                    className={styles.warnings}
                                    aria-label={`${driver.open_warnings} offene Warnungen`}
                                >
                                    {formatCount(driver.open_warnings)}
                                </span>
                                <Link
                                    className={styles.sideLink}
                                    to={driverAlertsPath(driver.id)}
                                    aria-label={`Warnungen von ${driver.name}`}
                                >
                                    Warnungen
                                </Link>
                            </span>
                        </li>
                    ))}
                    footer={
                        !talk.isLoading && talk.total > 0 ? (
                            <Link to={talkListPath(search)}>
                                Alle {formatCount(talk.total)} anzeigen →
                            </Link>
                        ) : null
                    }
                />

                <BoardColumn
                    tone="warning"
                    title="Papiere fehlen"
                    count={licenceLoading ? null : licenceTotal}
                    rule="Ablaufdatum fehlt, Führerschein läuft ab oder Kontrolle überfällig"
                    isLoading={licenceLoading}
                    error={licenceError}
                    onRetry={() => licenceLists.forEach(({ list }) => list.retry())}
                    empty={searchEmpty("Führerscheindaten sind vollständig.")}
                    rows={licenceRows.map((row) => (
                        <li key={`${row.kind}-${row.state}-${row.driver_id}`}>
                            <Link
                                className={`${styles.row} ${styles.rowLink}`}
                                to={`/drivers/${row.driver_id}`}
                                state={from}
                            >
                                <span className={styles.who}>
                                    <span className={styles.name}>{row.label}</span>
                                    <span className={styles.meta}>
                                        {licenceStateText(row)}
                                    </span>
                                </span>
                                <span className={styles.action}>Öffnen</span>
                            </Link>
                        </li>
                    ))}
                    footer={
                        licenceLoading ? null : (
                            <span className={styles.footLinks}>
                                <span>In den Fristen öffnen:</span>
                                {licenceLists
                                    .filter(({ list }) => list.total > 0)
                                    .map(({ group, list }) => (
                                        <Link
                                            key={group.id}
                                            to={duePath(group.state, group.kind, search)}
                                        >
                                            {group.label} {formatCount(list.total)} →
                                        </Link>
                                    ))}
                                {licenceTotal === 0 && (
                                    <Link to="/fristen">Fristen →</Link>
                                )}
                            </span>
                        )
                    }
                />

                <BoardColumn
                    tone="neutral"
                    title="Ohne Fahrzeug"
                    count={without.isLoading ? null : without.total}
                    rule="Kein aktuelles Fahrzeug eingeteilt"
                    isLoading={without.isLoading}
                    error={without.error}
                    onRetry={without.retry}
                    empty={searchEmpty("Alle Fahrer sind eingeteilt.")}
                    rows={without.data.map((driver) => (
                        <li key={driver.id}>
                            <Link
                                className={`${styles.row} ${styles.rowLink}`}
                                to={`/drivers/${driver.id}`}
                                state={from}
                            >
                                <span className={styles.who}>
                                    <span className={styles.name}>{driver.name}</span>
                                    <span className={styles.meta}>
                                        {eligibilityText(driver.vehicle_count)}
                                    </span>
                                </span>
                                <span className={styles.action}>Öffnen</span>
                            </Link>
                        </li>
                    ))}
                    footer={
                        !without.isLoading && without.total > 0 ? (
                            <Link to={withoutVehicleListPath(search)}>
                                Alle {formatCount(without.total)} anzeigen →
                            </Link>
                        ) : null
                    }
                />
            </div>
        </section>
    );
};
