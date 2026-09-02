import { Link } from "react-router";
import type { BriefingCounts, BriefingData } from "@fleet-live/shared";

import { BriefingCharts } from "../components/briefing/BriefingCharts";
import { useBriefing } from "../hooks/useBriefing";
import { formatCount } from "../utils/formatCount";
import styles from "./BriefingPage.module.scss";

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
        accent?: boolean;
        to?: string;
    }> = [
        {
            key: "open",
            label: "Offen",
            hint: "Inbox",
            accent: true,
            to: "/alerts",
        },
        {
            key: "offline",
            label: "Kein Signal",
            hint: "Fahrzeuge",
            to: "/vehicles?filter=offline",
        },
        {
            key: "driving",
            label: "Auf Fahrt",
            to: "/vehicles?filter=driving",
        },
        {
            key: "idle",
            label: "Standby",
            to: "/vehicles?filter=idle",
        },
        {
            key: "low_fuel",
            label: "Wenig Tank",
            to: "/alerts?type=LOW_FUEL",
        },
    ];

    return (
        <div className={styles.kpis}>
            {tiles.map((tile) => {
                const body = (
                    <>
                        <span className={styles.kpiLabel}>{tile.label}</span>
                        <span
                            className={styles.kpiValue}
                            data-accent={tile.accent ? "true" : undefined}
                        >
                            {formatCount(counts[tile.key])}
                        </span>
                        {tile.hint ? (
                            <span className={styles.kpiHint}>{tile.hint}</span>
                        ) : null}
                    </>
                );

                if (tile.to) {
                    return (
                        <Link
                            key={tile.key}
                            className={styles.kpi}
                            to={tile.to}
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

const BriefingBody = ({ data }: { data: BriefingData }) => (
    <>
        <header className={styles.header}>
            <h1 className={styles.title}>Schicht</h1>
            <p className={styles.subtitle}>
                {briefingDateLabel()} · {briefingNeed(data.counts.open)}
            </p>
        </header>
        <Kpis counts={data.counts} />
        <BriefingCharts history={data.history} />
    </>
);

export const BriefingPage = () => {
    const { data, isLoading, error } = useBriefing();

    if (isLoading) {
        return (
            <section className={styles.page}>
                <header className={styles.header}>
                    <h1 className={styles.title}>Schicht</h1>
                    <p className={styles.statusLine}>Laden…</p>
                </header>
            </section>
        );
    }

    if (error || !data) {
        return (
            <section className={styles.page}>
                <header className={styles.header}>
                    <h1 className={styles.title}>Schicht</h1>
                    <p className={styles.error}>
                        {error ?? "Schicht konnte nicht geladen werden."}
                    </p>
                </header>
            </section>
        );
    }

    return (
        <section className={styles.page}>
            <BriefingBody data={data} />
        </section>
    );
};
