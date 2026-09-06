import type { CSSProperties } from "react";
import {
    CartesianGrid,
    Line,
    LineChart,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import { useChartTheme } from "../../hooks/useChartTheme";
import { CHART_SERIES, yCeiling, type TypeMonth } from "./briefingChartSeries";
import { ChartCard } from "./ChartCard";
import { ChartTooltipRow, ChartTooltipShell } from "./ChartTooltipShell";
import { isTypeMonth, type TooltipRow } from "./chartTooltipTypes";
import styles from "./BriefingCharts.module.scss";

const TYPE_LINES = [
    {
        key: "rate" as const,
        label: "Fahrer mit Tempo-Verstoß",
        color: CHART_SERIES.speeding,
        width: 2.75,
        dash: null,
    },
    {
        key: "highShare" as const,
        label: "Davon deutlich über dem Limit",
        color: null,
        width: 1.5,
        dash: "4 3",
    },
    {
        key: "lowFuel" as const,
        label: "Fahrzeuge mit wenig Tank",
        color: CHART_SERIES.lowFuel,
        width: 1.5,
        dash: "4 3",
    },
    {
        key: "offline" as const,
        label: "Fahrzeuge ohne Signal",
        color: CHART_SERIES.offline,
        width: 1.5,
        dash: "4 3",
    },
];

const asNumber = (value: TooltipRow["value"]): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    return null;
};

const TypeTooltip = ({
    active,
    payload,
    label,
    accent,
    year,
}: {
    active?: boolean;
    payload?: ReadonlyArray<TooltipRow>;
    label?: string | number;
    accent: string;
    year: string;
}) => {
    if (!active || !payload?.length) {
        return null;
    }

    if (!isTypeMonth(payload[0]?.payload)) {
        return null;
    }

    return (
        <ChartTooltipShell label={String(label)} year={year}>
            {payload.map((entry) => {
                const series = TYPE_LINES.find((line) => line.key === entry.dataKey);
                const value = asNumber(entry.value);

                if (!series || value === null) {
                    return null;
                }

                const color = series.color ?? accent;

                return (
                    <ChartTooltipRow
                        key={String(entry.dataKey)}
                        label={series.label}
                        value={`${value}%`}
                        color={color}
                    />
                );
            })}
        </ChartTooltipShell>
    );
};

export const BriefingTypeChart = ({
    series,
    year,
}: {
    series: TypeMonth[];
    year: string;
}) => {
    const theme = useChartTheme();
    const tick = { fill: theme.text, fontSize: 12 } as const;
    const yMax = yCeiling(
        series.flatMap((row) => [row.rate, row.lowFuel, row.offline, row.highShare]),
        20,
    );

    return (
        <ChartCard
            className={styles.hero}
            kicker="Übersicht"
            title="Was ist in dem Monat schiefgelaufen?"
            lead="Dicke Linie: Anteil der Fahrer mit Tempo-Verstoß. Gestrichelt violett: wie krass die Tempo-Vorfälle waren (deutlich über dem Streckenlimit). Tank und Funk sind Betrieb — nicht Fahrerfehler. Die Linien dürfen sich trennen: viele milde Verstöße vs. wenige harte."
            note="Die vier Linien haben verschiedene Bedeutungen. Nicht zusammenzählen."
            footer={
                <ul className={styles.legend}>
                    {TYPE_LINES.map((line) => {
                        const color = line.color ?? theme.accent;
                        const swatchStyle: CSSProperties = line.dash
                            ? { color, borderColor: color }
                            : { background: color };

                        return (
                            <li key={line.key} className={styles.legendItem}>
                                <span
                                    className={styles.swatch}
                                    data-dash={line.dash ? "true" : undefined}
                                    style={swatchStyle}
                                />
                                {line.label}
                            </li>
                        );
                    })}
                </ul>
            }
        >
            <LineChart
                data={series}
                margin={{ top: 10, right: 8, left: 0, bottom: 0 }}
            >
                <CartesianGrid stroke={theme.border} vertical={false} />
                <XAxis
                    dataKey="month"
                    tick={tick}
                    axisLine={{ stroke: theme.border }}
                    tickLine={false}
                />
                <YAxis
                    tick={tick}
                    axisLine={false}
                    tickLine={false}
                    domain={[0, yMax]}
                    tickFormatter={(value: number) => `${value}%`}
                    width={40}
                />
                <Tooltip
                    content={<TypeTooltip accent={theme.accent} year={year} />}
                    cursor={{ stroke: theme.border }}
                />
                {TYPE_LINES.map((line) => {
                    const color = line.color ?? theme.accent;

                    return (
                        <Line
                            key={line.key}
                            type="monotone"
                            dataKey={line.key}
                            stroke={color}
                            strokeWidth={line.width}
                            strokeDasharray={line.dash ?? undefined}
                            dot={{
                                r: line.key === "rate" ? 3.5 : 2.5,
                                fill: color,
                                strokeWidth: 0,
                            }}
                            activeDot={{ r: 5, fill: color, strokeWidth: 0 }}
                            isAnimationActive={false}
                        />
                    );
                })}
            </LineChart>
        </ChartCard>
    );
};
