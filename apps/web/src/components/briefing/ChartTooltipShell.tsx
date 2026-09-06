import type { ReactNode } from "react";

import styles from "./BriefingCharts.module.scss";

export const ChartTooltipShell = ({
    label,
    year,
    children,
}: {
    label: string;
    year: string;
    children: ReactNode;
}) => (
    <div className={styles.tooltip}>
        <p className={styles.tooltipLabel}>
            {label} {year}
        </p>
        {children}
    </div>
);

export const ChartTooltipRow = ({
    label,
    value,
    color,
}: {
    label: string;
    value: ReactNode;
    color?: string;
}) => (
    <div className={styles.tooltipRow}>
        <span className={styles.tooltipMuted}>{label}</span>
        <span className={styles.tooltipNum} style={color ? { color } : undefined}>
            {value}
        </span>
    </div>
);
