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

import { useChartTheme } from "../../hooks/useChartTheme";
import {
    CHART_SERIES,
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
                label="Tempo-Vorfälle je 1.000 km"
                value={row.eventsPer1000km ?? "—"}
                color={CHART_SERIES.km}
            />
            <ChartTooltipRow
                label="Davon deutlich über dem Limit"
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
}: {
    series: KmMonth[];
    year: string;
}) => {
    const theme = useChartTheme();
    const tick = { fill: theme.text, fontSize: 12 } as const;
    const kmStart = firstKmMonth(series);
    const kmMax = yCeiling(
        series.map((row) => row.eventsPer1000km ?? 0),
        1,
        0.5,
    );
    const highMax = yCeiling(
        series.map((row) => row.highShare),
        20,
    );

    return (
        <ChartCard
            compact
            kicker="Pro Kilometer"
            title="Passiert das oft — oder nur, weil viel gefahren wird?"
            lead="Tempo-Vorfälle je 1.000 gefahrene Kilometer. Wenn die Flotte wächst oder mehr Touren fährt, bleibt die Zahl vergleichbar. Die Balken daneben: wie groß der Anteil der schweren Tempo-Vorfälle war."
            note="Die Monatssumme bleibt, auch wenn alte Fahrten (der Verlauf auf der Karte) gelöscht werden."
            footer={
                <ul className={styles.legend}>
                    <li className={styles.legendItem}>
                        <span
                            className={styles.swatch}
                            style={{ background: CHART_SERIES.km }}
                        />
                        Tempo-Vorfälle je 1.000 km
                    </li>
                    <li className={styles.legendItem}>
                        <span
                            className={styles.swatch}
                            style={{ background: CHART_SERIES.speeding, opacity: 0.45 }}
                        />
                        Davon deutlich über dem Limit
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
                    axisLine={{ stroke: theme.border }}
                    tickLine={false}
                />
                <YAxis
                    yAxisId="left"
                    tick={{ ...tick, fill: CHART_SERIES.km }}
                    axisLine={false}
                    tickLine={false}
                    domain={[0, kmMax]}
                    width={36}
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
                        label={{
                            value: "km erst ab hier",
                            position: "insideTopLeft",
                            fill: theme.text,
                            fontSize: 11,
                        }}
                    />
                ) : null}
                <Bar
                    yAxisId="right"
                    dataKey="highShare"
                    fill={CHART_SERIES.speeding}
                    fillOpacity={0.22}
                    barSize={18}
                    radius={[3, 3, 0, 0]}
                    name="Davon deutlich über dem Limit"
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
                    name="Tempo-Vorfälle je 1.000 km"
                    isAnimationActive={false}
                />
            </ComposedChart>
        </ChartCard>
    );
};
