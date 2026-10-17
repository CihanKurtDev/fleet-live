import { useState, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router";
import {
    DUE_KIND_LABELS,
    TODAY_KINDS,
    type TodayItem,
    type TodayKind,
} from "@fleet-live/shared";

import { resolveAlert } from "../../api/alerts";
import { useAuth } from "../../hooks/useAuth";
import { useBoundHeight } from "../../hooks/useBoundHeight";
import { useToday } from "../../hooks/useToday";
import { formatRelativeTimestamp } from "../../utils/dateTime";
import { formatCount } from "../../utils/formatCount";
import { dueSoonLabel } from "../due/dueLabels";
import { Button } from "../ui/Button/Button";
import { RetryMessage } from "../ui/RetryMessage";
import { DeadlineEditDialog } from "./DeadlineEditDialog";
import styles from "./TodayPanel.module.scss";

/** Rows are 48 px (rules/design-system.md). */
const ROW_HEIGHT = 48;

type Tone = "critical" | "warning" | "neutral";

const KIND: Record<
    TodayKind,
    { tag: string; chip: string; to: string; tone: Tone }
> = {
    deadline_overdue: {
        tag: "Überfällig",
        chip: "Fristen überfällig",
        to: "/fristen?state=overdue",
        tone: "critical",
    },
    driving_unassigned: {
        tag: "Ohne Fahrer",
        chip: "Fährt ohne Fahrer",
        to: "/vehicles?filter=driving_unassigned",
        tone: "warning",
    },
    driver_talk: {
        tag: "Gespräch",
        chip: "Gespräch führen",
        to: "/drivers?min_open_warnings=5",
        tone: "warning",
    },
    offline: {
        tag: "Kein Signal",
        chip: "Kein Signal",
        to: "/alerts?type=OFFLINE",
        tone: "neutral",
    },
    low_fuel: {
        tag: "Wenig Tank",
        chip: "Wenig Tank",
        to: "/vehicles?filter=low_fuel",
        tone: "warning",
    },
    deadline_soon: {
        tag: "Bald fällig",
        chip: "Fristen bald fällig",
        to: "/fristen?state=soon",
        tone: "warning",
    },
};

/** "06.2026" for a month, "03.10.2026" for a day. */
const formatDue = (value: string) => {
    const [year, month, day] = value.split("-");
    return day ? `${day}.${month}.${year}` : `${month}.${year}`;
};

const reason = (item: TodayItem): string => {
    switch (item.kind) {
        case "deadline_overdue":
        case "deadline_soon": {
            const label = item.due_kind ? DUE_KIND_LABELS[item.due_kind] : "Frist";
            if (item.due_on === null) {
                return item.due_kind === "licence_check"
                    ? `${label} · noch nie kontrolliert`
                    : `${label} · kein Datum`;
            }
            return `${label} · ${item.kind === "deadline_overdue" ? "seit" : "am"} ${formatDue(item.due_on)}`;
        }
        case "driving_unassigned":
            return "Auf Fahrt ohne zugewiesenen Fahrer";
        case "driver_talk":
            return `${item.open_warnings ?? 0} offene Tempo-Warnungen`;
        case "offline":
            return `Meldet sich nicht · Warnung ${formatRelativeTimestamp(item.since)}`;
        case "low_fuel":
            return `Tankstand ${Math.round(item.fuel_level ?? 0)} %`;
    }
};

/**
 * "Heute dran" on Schicht: the most urgent tasks across the fleet, one row
 * each, with one next step. The chips above count every task of a kind and
 * open the list that shows exactly those.
 */
export const TodayPanel = () => {
    const { user } = useAuth();
    const canWrite = user?.role === "dispatcher";
    const navigate = useNavigate();
    const { ref, height } = useBoundHeight<HTMLUListElement>();
    // Phones stack the page: a fixed handful there.
    const limit = height > 0 ? Math.max(1, Math.floor(height / ROW_HEIGHT)) : 6;
    const { data, error, reload } = useToday(limit);
    const [editing, setEditing] = useState<TodayItem | null>(null);
    const [busyAlert, setBusyAlert] = useState<number | null>(null);
    const [notice, setNotice] = useState("");

    const soonLabel = data ? dueSoonLabel(data.meta.lead_days) : "Bald";
    const tagOf = (kind: TodayKind) =>
        kind === "deadline_soon" ? soonLabel : KIND[kind].tag;
    const chipOf = (kind: TodayKind) =>
        kind === "deadline_soon"
            ? `Fristen ${soonLabel.charAt(0).toLowerCase()}${soonLabel.slice(1)}`
            : KIND[kind].chip;

    const open = (item: TodayItem) => {
        const to =
            item.vehicle_id !== null
                ? `/vehicles/${item.vehicle_id}`
                : `/drivers/${item.driver_id}`;
        navigate(to, { state: { from: "/" }, viewTransition: true });
    };

    const onRowKey = (event: KeyboardEvent, item: TodayItem) => {
        if (event.key === "Enter") {
            event.preventDefault();
            open(item);
        }
    };

    const resolveOffline = async (item: TodayItem) => {
        if (item.alert_id === null) {
            return;
        }

        setBusyAlert(item.alert_id);
        try {
            await resolveAlert(item.alert_id);
            setNotice(`Warnung für ${item.subject} erledigt.`);
            reload();
        } catch (caught: unknown) {
            setNotice(
                caught instanceof Error
                    ? caught.message
                    : "Warnung konnte nicht erledigt werden.",
            );
        } finally {
            setBusyAlert(null);
        }
    };

    const action = (item: TodayItem) => {
        if (!canWrite) {
            return null;
        }

        if (item.kind === "deadline_overdue" || item.kind === "deadline_soon") {
            return (
                <Button
                    variant="secondary"
                    size="row"
                    onClick={(event) => {
                        event.stopPropagation();
                        setNotice("");
                        setEditing(item);
                    }}
                >
                    Eintragen
                </Button>
            );
        }

        if (item.kind === "offline") {
            return (
                <Button
                    variant="secondary"
                    size="row"
                    busy={busyAlert === item.alert_id}
                    busyLabel="Erledigen…"
                    onClick={(event) => {
                        event.stopPropagation();
                        void resolveOffline(item);
                    }}
                >
                    Erledigen
                </Button>
            );
        }

        return null;
    };

    return (
        <section className={styles.panel} aria-labelledby="today-title">
            <div className={styles.head}>
                <h2 id="today-title" className={styles.title}>
                    Heute dran
                </h2>
                <span className={styles.hint}>dringendstes zuerst</span>
                <p className={styles.notice} role="status" aria-live="polite">
                    {notice}
                </p>
            </div>

            {data && (
                <div className={styles.kinds}>
                    {TODAY_KINDS.filter((kind) => data.meta.counts[kind] > 0).map(
                        (kind) => (
                            <Link
                                key={kind}
                                className={styles.kind}
                                data-tone={KIND[kind].tone}
                                to={KIND[kind].to}
                                viewTransition
                            >
                                <b>{formatCount(data.meta.counts[kind])}</b>
                                {chipOf(kind)}
                            </Link>
                        ),
                    )}
                </div>
            )}

            <ul ref={ref} className={styles.list}>
                {error && (
                    <li className={styles.empty}>
                        <RetryMessage message={error} onRetry={reload} />
                    </li>
                )}
                {!error && data && data.data.length === 0 && (
                    <li className={styles.empty}>
                        Nichts offen. Gute Schicht.
                    </li>
                )}
                {data?.data.map((item) => (
                    <li
                        key={item.key}
                        className={styles.row}
                        role="link"
                        tabIndex={0}
                        aria-label={`${item.subject}: ${reason(item)}`}
                        onClick={() => open(item)}
                        onKeyDown={(event) => onRowKey(event, item)}
                    >
                        <span
                            className={styles.tag}
                            data-tone={KIND[item.kind].tone}
                        >
                            {tagOf(item.kind)}
                        </span>
                        <span className={styles.what}>
                            <b>{item.subject}</b>
                            <span>{reason(item)}</span>
                        </span>
                        <span className={styles.action}>{action(item)}</span>
                    </li>
                ))}
            </ul>

            {data && (
                <p className={styles.foot}>
                    Die nächsten {formatCount(data.data.length)} von{" "}
                    {formatCount(data.meta.total)} offenen Aufgaben
                </p>
            )}

            <DeadlineEditDialog
                item={editing}
                onClose={() => setEditing(null)}
                onSaved={() => {
                    if (editing) {
                        setNotice(`${editing.subject} gespeichert.`);
                    }
                    setEditing(null);
                    reload();
                }}
            />
        </section>
    );
};
