import {
    Area,
    CartesianGrid,
    ComposedChart,
    Line,
    ReferenceDot,
    ReferenceLine,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import { useChartTheme } from "../../hooks/useChartTheme";
import { CHART_SERIES, yCeiling, type RateMonth } from "./briefingChartSeries";
import { ChartCard } from "./ChartCard";
import { ChartTooltipShell } from "./ChartTooltipShell";
import { isRateMonth, type TooltipRow } from "./chartTooltipTypes";
import styles from "./BriefingCharts.module.scss";

const RateTooltip = ({
    active,
    payload,
    label,
    year,
}: {
    active?: boolean;
    payload?: ReadonlyArray<TooltipRow>;
    label?: string | number;
    year: string;
}) => {
    if (!active || !payload?.length) {
        return null;
    }

    const row = payload[0]?.payload;

    if (!isRateMonth(row)) {
        return null;
    }

    return (
        <ChartTooltipShell label={String(label)} year={year}>
            <p
                className={styles.tooltipValue}
                style={{ color: CHART_SERIES.speeding }}
            >
                {row.rate}%
            </p>
            <p className={styles.tooltipHint}>
                {row.verstoss} von {row.aktiveFahrer} Fahrern
                {" "}hatten mindestens einen Tempo-Verstoß
            </p>
        </ChartTooltipShell>
    );
};

export const BriefingRateChart = ({
    series,
    baseline,
    year,
}: {
    series: RateMonth[];
    baseline: number;
    year: string;
}) => {
    const theme = useChartTheme();
    const tick = { fill: theme.text, fontSize: 12 } as const;
    const last = series[series.length - 1];
    const before = series[series.length - 2];
    const yMax = yCeiling(series.map((row) => row.rate), 12);

    return (
        <ChartCard
            compact
            kicker="Nur Tempo"
            title="Wie viele Fahrer waren zu schnell?"
            lead="Von allen Fahrern mit Fahrzeug: wie viel Prozent hatten in dem Monat mindestens einen Tempo-Verstoß. Ein Fahrer zählt einmal — egal ob er einmal oder zehnmal zu schnell war."
            note="Die gestrichelte Linie ist der Schnitt der Vormonate. Steigt die Kurve darüber, wird es ungewöhnlich."
        >
            <ComposedChart
                data={series}
                margin={{ top: 28, right: 12, left: 0, bottom: 0 }}
            >
                <defs>
                    <linearGradient id="briefingRateFill" x1="0" y1="0" x2="0" y2="1">
                        <stop
                            offset="0%"
                            stopColor={CHART_SERIES.speeding}
                            stopOpacity={0.22}
                        />
                        <stop
                            offset="100%"
                            stopColor={CHART_SERIES.speeding}
                            stopOpacity={0}
                        />
                    </linearGradient>
                </defs>
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
                    content={<RateTooltip year={year} />}
                    cursor={{ stroke: theme.border }}
                />
                <ReferenceLine
                    y={baseline}
                    stroke={theme.text}
                    strokeDasharray="3 5"
                    label={{
                        value: `Schnitt Vormonate ${baseline}%`,
                        position: "insideTopLeft",
                        fill: theme.text,
                        fontSize: 11,
                    }}
                />
                <Area
                    type="monotone"
                    dataKey="rate"
                    stroke="none"
                    fill="url(#briefingRateFill)"
                    isAnimationActive={false}
                />
                <Line
                    type="monotone"
                    dataKey="rate"
                    stroke={CHART_SERIES.speeding}
                    strokeWidth={2.5}
                    dot={{
                        r: 3.5,
                        fill: CHART_SERIES.speeding,
                        strokeWidth: 0,
                    }}
                    activeDot={{
                        r: 5.5,
                        fill: CHART_SERIES.speeding,
                        strokeWidth: 0,
                    }}
                    isAnimationActive={false}
                />
                {before ? (
                    <ReferenceDot
                        x={before.month}
                        y={before.rate}
                        r={0}
                        label={{
                            value: `${before.verstoss} / ${before.aktiveFahrer}`,
                            position: "top",
                            fill: theme.text,
                            fontSize: 11,
                        }}
                    />
                ) : null}
                {last ? (
                    <ReferenceDot
                        x={last.month}
                        y={last.rate}
                        r={0}
                        label={{
                            value: `${last.verstoss} / ${last.aktiveFahrer}`,
                            position: "top",
                            fill: CHART_SERIES.speeding,
                            fontSize: 11,
                        }}
                    />
                ) : null}
            </ComposedChart>
        </ChartCard>
    );
};
