import {
    Bar,
    CartesianGrid,
    ComposedChart,
    Line,
    ReferenceLine,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import { SPEED_CRITICAL_OVER_LIMIT_KMH } from "@fleet-live/shared";

import { useChartTheme } from "../../hooks/useChartTheme";
import {
    CHART_SERIES,
    HIGH_SHARE_LABEL,
    firstKmMonth,
    yCeiling,
    type KmMonth,
} from "./briefingChartSeries";
import { ChartCard } from "./ChartCard";
import { ChartTooltipRow, ChartTooltipShell } from "./ChartTooltipShell";
import { isKmMonth, type TooltipRow } from "./chartTooltipTypes";
import styles from "./BriefingCharts.module.scss";

const KmTooltip = ({
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

    if (!isKmMonth(row)) {
        return null;
    }

    return (
        <ChartTooltipShell label={String(label)} year={year}>
            <ChartTooltipRow
                label="Tempo-Warnungen je 1.000 km"
                value={row.eventsPer1000km ?? "—"}
                color={CHART_SERIES.km}
            />
            <ChartTooltipRow
                label={HIGH_SHARE_LABEL}
                value={`${row.highShare}%`}
                color={CHART_SERIES.speeding}
            />
            {row.eventsPer1000km === null ? (
                <p className={styles.tooltipHint}>
                    Keine gefahrenen Kilometer in diesem Monat
                </p>
            ) : null}
        </ChartTooltipShell>
    );
};

export const BriefingKmChart = ({
    series,
    year,
    empty = false,
}: {
    series: KmMonth[];
    year: string;
    /** No month has driven kilometres yet. */
    empty?: boolean;
}) => {
    const theme = useChartTheme();
    const tick = { fill: theme.text, fontSize: 12 } as const;
    const kmStart = firstKmMonth(series);
    const kmMax = yCeiling(
        series.map((row) => row.eventsPer1000km ?? 0),
        0.1,
        0.05,
    );
    const highMax = yCeiling(
        series.map((row) => row.highShare),
        20,
        5,
        100,
    );

    return (
        <ChartCard
            compact
            kicker="Pro Kilometer"
            title="Passiert das oft — oder nur, weil viel gefahren wird?"
            lead="Tempo-Warnungen je 1.000 km: vergleichbar, auch wenn die Flotte wächst."
            note={`Balken: Anteil mit ${SPEED_CRITICAL_OVER_LIMIT_KMH} km/h oder mehr über dem Limit.`}
            blank={
                empty
                    ? "Die Balken erscheinen nach den ersten gefahrenen Kilometern."
                    : undefined
            }
            footer={
                <ul className={styles.legend}>
                    <li className={styles.legendItem}>
                        <span
                            className={styles.swatch}
                            style={{ background: CHART_SERIES.km }}
                        />
                        Tempo-Warnungen je 1.000 km
                    </li>
                    <li className={styles.legendItem}>
                        <span
                            className={styles.swatch}
                            style={{ background: CHART_SERIES.speeding, opacity: 0.45 }}
                        />
                        {HIGH_SHARE_LABEL}
                    </li>
                </ul>
            }
        >
            <ComposedChart
                data={series}
                margin={{ top: 18, right: 8, left: 0, bottom: 0 }}
            >
                <CartesianGrid stroke={theme.border} vertical={false} />
                <XAxis
                    dataKey="month"
                    tick={tick}
                    interval={1}
                    axisLine={{ stroke: theme.border }}
                    tickLine={false}
                />
                <YAxis
                    yAxisId="left"
                    tick={{ ...tick, fill: CHART_SERIES.km }}
                    axisLine={false}
                    tickLine={false}
                    domain={[0, kmMax]}
                    tickFormatter={(value: number) =>
                        value.toLocaleString("de-DE", { maximumFractionDigits: 2 })
                    }
                    width={40}
                />
                <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ ...tick, fill: CHART_SERIES.speeding }}
                    axisLine={false}
                    tickLine={false}
                    domain={[0, highMax]}
                    tickFormatter={(value: number) => `${value}%`}
                    width={36}
                />
                <Tooltip
                    content={<KmTooltip year={year} />}
                    cursor={{ stroke: theme.border }}
                />
                {kmStart ? (
                    <ReferenceLine
                        x={kmStart}
                        yAxisId="left"
                        stroke={theme.border}
                        strokeDasharray="3 5"
                    />
                ) : null}
                <Bar
                    yAxisId="right"
                    dataKey="highShare"
                    fill={CHART_SERIES.speeding}
                    fillOpacity={0.22}
                    barSize={18}
                    radius={[3, 3, 0, 0]}
                    name={HIGH_SHARE_LABEL}
                    isAnimationActive={false}
                />
                <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="eventsPer1000km"
                    stroke={CHART_SERIES.km}
                    strokeWidth={2.5}
                    dot={{ r: 3.5, fill: CHART_SERIES.km, strokeWidth: 0 }}
                    activeDot={{
                        r: 5.5,
                        fill: CHART_SERIES.km,
                        strokeWidth: 0,
                    }}
                    connectNulls={false}
                    name="Tempo-Warnungen je 1.000 km"
                    isAnimationActive={false}
                />
            </ComposedChart>
        </ChartCard>
    );
};
