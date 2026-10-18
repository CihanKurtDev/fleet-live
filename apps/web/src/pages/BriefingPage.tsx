import { Link } from "react-router";
import type {
    BriefingCounts,
    BriefingData,
    DueCounts,
} from "@fleet-live/shared";
import { ImportPrompt } from "../components/auth/ImportPrompt";

import { BriefingCharts } from "../components/briefing/BriefingCharts";
import { FirstSteps } from "../components/briefing/FirstSteps";
import { LiveBand } from "../components/briefing/LiveBand";
import { TodayPanel } from "../components/briefing/TodayPanel";
import { PageTips } from "../components/help/PageTips";
import { dueSoonLabel } from "../components/due/dueLabels";
import { ExportButton } from "../components/export/ExportButton";
import { buttonClass } from "../components/ui/Button/buttonClass";
import { RetryMessage } from "../components/ui/RetryMessage";
import { useAuth } from "../hooks/useAuth";
import { useBriefing } from "../hooks/useBriefing";
import { usePageTitle } from "../hooks/usePageTitle";
import { formatCount } from "../utils/formatCount";
import styles from "./BriefingPage.module.scss";
import band from "../styles/pageBand.module.scss";

const briefingDateLabel = (now = new Date()) =>
    new Intl.DateTimeFormat("de-DE", {
        weekday: "long",
        day: "numeric",
        month: "long",
    }).format(now);

const briefingNeed = (open: number) => {
    if (open === 0) {
        return "Keine offenen Warnungen.";
    }

    if (open === 1) {
        return "1 offene Warnung braucht dich.";
    }

    return `${formatCount(open)} offene Warnungen brauchen dich.`;
};

const Kpis = ({ counts }: { counts: BriefingCounts }) => {
    const tiles: Array<{
        key: keyof BriefingCounts;
        label: string;
        hint?: string;
        tone: "critical" | "warning" | "positive" | "neutral";
        to?: string;
    }> = [
        {
            key: "open",
            label: "Offen",
            hint: "Warnungen",
            tone: "critical",
            to: "/alerts",
        },
        {
            key: "offline",
            label: "Kein Signal",
            hint: "Fahrzeuge",
            tone: "critical",
            to: "/vehicles?filter=offline",
        },
        {
            key: "driving",
            label: "Auf Fahrt",
            tone: "positive",
            to: "/vehicles?filter=driving",
        },
        {
            key: "idle",
            label: "Standby",
            tone: "neutral",
            to: "/vehicles?filter=idle",
        },
        {
            key: "low_fuel",
            label: "Wenig Tank",
            tone: "warning",
            to: "/vehicles?filter=low_fuel",
        },
        {
            key: "in_depot",
            label: "Im Depot",
            hint: "im Kreis",
            tone: "neutral",
            to: "/vehicles?filter=in_depot",
        },
    ];

    return (
        <div className={styles.kpis} data-tip="briefing-kpis">
            {tiles.map((tile) => {
                const body = (
                    <>
                        <span className={styles.kpiLabel} title={tile.label}>
                            {tile.label}
                        </span>
                        <span
                            key={counts[tile.key]}
                            className={styles.kpiValue}
                        >
                            {formatCount(counts[tile.key])}
                        </span>
                        {tile.hint ? (
                            <span className={styles.kpiHint} title={tile.hint}>
                                {tile.hint}
                            </span>
                        ) : null}
                    </>
                );

                if (tile.to) {
                    return (
                        <Link
                            key={tile.key}
                            className={`${styles.kpi} ${styles[`kpi${tile.tone[0].toUpperCase()}${tile.tone.slice(1)}`]}`}
                            to={tile.to}
                            viewTransition
                        >
                            {body}
                        </Link>
                    );
                }

                return (
                    <div key={tile.key} className={styles.kpi}>
                        {body}
                    </div>
                );
            })}
        </div>
    );
};

const missingFields = (due: DueCounts) =>
    due.missing.hu + due.missing.uvv + due.missing.licence_expiry;

const DueKpis = ({
    due,
    leadDays,
}: {
    due: DueCounts;
    leadDays: number;
}) => {
    const tiles: Array<{
        key: string;
        label: string;
        value: number;
        hint?: string;
        tone: "critical" | "warning" | "neutral";
        to: string;
    }> = [
        {
            key: "overdue",
            label: "Überfällig",
            value: due.overdue,
            tone: "critical",
            to: "/fristen?state=overdue",
        },
        {
            key: "soon",
            label: dueSoonLabel(leadDays),
            value: due.soon,
            tone: "warning",
            to: "/fristen?state=soon",
        },
        {
            key: "missing",
            label: "Datum fehlt",
            value: missingFields(due),
            hint: "HU, UVV, Führerschein",
            tone: "neutral",
            to: "/fristen?state=missing",
        },
    ];

    return (
        <div className={styles.dueKpis} data-tip="briefing-due">
            {tiles.map((tile) => {
                const toneClass =
                    tile.tone === "critical"
                        ? styles.kpiCritical
                        : tile.tone === "warning"
                          ? styles.kpiWarning
                          : undefined;

                return (
                    <Link
                        key={tile.key}
                        className={
                            toneClass ? `${styles.kpi} ${toneClass}` : styles.kpi
                        }
                        to={tile.to}
                        viewTransition
                    >
                        <span className={styles.kpiLabel} title={tile.label}>
                            {tile.label}
                        </span>
                        <span key={tile.value} className={styles.kpiValue}>
                            {formatCount(tile.value)}
                        </span>
                        {tile.hint ? (
                            <span className={styles.kpiHint} title={tile.hint}>
                                {tile.hint}
                            </span>
                        ) : null}
                    </Link>
                );
            })}
        </div>
    );
};

const BriefingBody = ({
    data,
    canWrite,
}: {
    data: BriefingData;
    canWrite: boolean;
}) => (
    <>
        <LiveBand labelledBy="briefing-title">
            <header className={styles.headGrid}>
                <h1
                    id="briefing-title"
                    className={`${styles.title} ${styles.headTitle}`}
                >
                    Schicht
                </h1>
                <p className={styles.subtitle}>
                    {briefingDateLabel()} ·{" "}
                    <span className={styles.need}>
                        {briefingNeed(data.counts.open)}
                    </span>
                </p>
                <FirstSteps className={styles.headSteps} />
                <div className={styles.headAction}>
                    <Link
                        className={buttonClass("secondary", "sm")}
                        to="/fleet"
                        viewTransition
                    >
                        Karte öffnen
                    </Link>
                    {canWrite && <ExportButton kind="period" />}
                </div>
            </header>
            <div className={styles.tiles}>
                <Kpis counts={data.counts} />
                <span className={styles.tileSeparator} aria-hidden="true" />
                <DueKpis due={data.due} leadDays={data.due_lead_days} />
            </div>
        </LiveBand>
        <ImportPrompt />
        <BriefingCharts history={data.history} lead={<TodayPanel />} />
        <PageTips page="briefing" />
    </>
);

export const BriefingPage = () => {
    usePageTitle("Schicht");
    const { data, isLoading, error, retry } = useBriefing();
    const { user } = useAuth();
    const canWrite = user?.role === "dispatcher";

    if (isLoading) {
        return (
            <section className={styles.page}>
                <header className={`${band.band} ${band.bleed} ${styles.header}`}>
                    <h1 className={styles.title}>Schicht</h1>
                    <p className={styles.statusLine}>Laden…</p>
                </header>
            </section>
        );
    }

    if (error || !data) {
        return (
            <section className={styles.page}>
                <header className={`${band.band} ${band.bleed} ${styles.header}`}>
                    <h1 className={styles.title}>Schicht</h1>
                    <RetryMessage
                        message={
                            error ?? "Schicht konnte nicht geladen werden."
                        }
                        onRetry={retry}
                    />
                </header>
            </section>
        );
    }

    return (
        <section className={styles.page}>
            <BriefingBody data={data} canWrite={canWrite} />
        </section>
    );
};
