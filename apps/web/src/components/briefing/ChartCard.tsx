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
    children,
}: {
    kicker: string;
    title: string;
    lead: string;
    note: string;
    className?: string;
    compact?: boolean;
    footer?: ReactNode;
    children: ReactNode;
}) => (
    <section className={`${styles.card} ${className ?? ""}`.trim()}>
        <p className={styles.kicker}>{kicker}</p>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.lead}>{lead}</p>
        <div className={compact ? styles.chartCompact : styles.chart}>
            <ResponsiveContainer width="100%" height="100%">
                {children}
            </ResponsiveContainer>
        </div>
        {footer}
        <p className={styles.note}>{note}</p>
    </section>
);
