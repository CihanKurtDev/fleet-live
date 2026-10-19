import { Link } from "react-router";
import {
    VEHICLE_STATUS_LABELS,
    type BriefingCounts,
    type BriefingData,
    type DueCounts,
} from "@fleet-live/shared";
import { ImportPrompt } from "../components/auth/ImportPrompt";

import { BriefingCharts } from "../components/briefing/BriefingCharts";
import { FirstSteps } from "../components/briefing/FirstSteps";
import { LiveBand } from "../components/briefing/LiveBand";
import { TodayPanel } from "../components/briefing/TodayPanel";
import { KpiTileView, type KpiTileTone } from "../components/ui/KpiTiles/KpiTiles";
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
        tone: KpiTileTone;
        to: string;
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
            label: VEHICLE_STATUS_LABELS.OFFLINE,
            hint: "Fahrzeuge",
            tone: "critical",
            to: "/alerts?type=OFFLINE",
        },
        {
            key: "driving",
            label: VEHICLE_STATUS_LABELS.DRIVING,
            tone: "positive",
            to: "/vehicles?filter=driving",
        },
        {
            key: "idle",
            label: VEHICLE_STATUS_LABELS.IDLE,
            tone: "neutral",
            to: "/vehicles?filter=idle",
        },
        {
            key: "low_fuel",
            label: "Wenig Tank",
            tone: "warning",
            to: "/alerts?type=LOW_FUEL",
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
            {tiles.map((tile) => (
                <KpiTileView
                    key={tile.key}
                    surface="glass"
                    tile={{
                        key: tile.key,
                        label: tile.label,
                        value: counts[tile.key],
                        hint: tile.hint,
                        tone: tile.tone,
                        to: tile.to,
                    }}
                />
            ))}
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
        tone: KpiTileTone;
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
            {tiles.map((tile) => (
                <KpiTileView
                    key={tile.key}
                    surface="glass"
                    tile={{
                        key: tile.key,
                        label: tile.label,
                        value: tile.value,
                        hint: tile.hint,
                        tone: tile.tone,
                        to: tile.to,
                    }}
                />
            ))}
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
