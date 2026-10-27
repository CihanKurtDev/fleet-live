import type { ReactNode } from "react";
import { ResponsiveContainer } from "recharts";

import styles from "./BriefingCharts.module.scss";

export const ChartCard = ({
    kicker,
    title,
    lead,
    note,
    className,
    compact,
    footer,
    blank,
    children,
}: {
    kicker: string;
    title: string;
    lead: string;
    note: string;
    className?: string;
    compact?: boolean;
    footer?: ReactNode;
    /**
     * No month has data yet (new company): this line stands where the chart
     * would be, instead of empty axes. Legend and note go with the chart.
     */
    blank?: string;
    children: ReactNode;
}) => (
    <section className={`${styles.card} ${className ?? ""}`.trim()}>
        <p className={styles.kicker}>{kicker}</p>
        <h2 className={styles.title}>{title}</h2>
        {/* Lower windows cut the text to one line; the title gives all of it. */}
        <p className={styles.lead} title={lead}>
            {lead}
        </p>
        {blank ? (
            <div
                className={`${compact ? styles.chartCompact : styles.chart} ${styles.blank}`}
            >
                <p className={styles.blankTitle}>Noch kein Verlauf</p>
                <p className={styles.blankText}>{blank}</p>
            </div>
        ) : (
            <>
                <div className={compact ? styles.chartCompact : styles.chart}>
                    <ResponsiveContainer width="100%" height="100%">
                        {children}
                    </ResponsiveContainer>
                </div>
                {footer}
                <p className={styles.note} title={note}>
                    {note}
                </p>
            </>
        )}
    </section>
);
