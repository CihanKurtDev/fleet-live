import type { CSSProperties, ReactNode } from "react";
import {
    Area,
    Bar,
    CartesianGrid,
    ComposedChart,
    Line,
    LineChart,
    ReferenceDot,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import type { BriefingHistoryMonth } from "@fleet-live/shared";
import { useChartTheme } from "../../hooks/useChartTheme";
import {
    CHART_SERIES,
    firstKmMonth,
    historyYear,
    rateBaseline as baselineFromSeries,
    toKmSeries,
    toRateSeries,
    toTypeSeries,
    yCeiling,
    type KmMonth,
    type RateMonth,
    type TypeMonth,
} from "./briefingChartSeries";
import {
    isKmMonth,
    isRateMonth,
    isTypeMonth,
    type TooltipRow,
} from "./chartTooltipTypes";
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

const ChartCard = ({
    kicker,
    title,
    lead,
    note,
    className,
    children,
}: {
    kicker: string;
    title: string;
    lead: string;
    note: string;
    className?: string;
    children: ReactNode;
}) => (
    <section className={`${styles.card} ${className ?? ""}`.trim()}>
        <p className={styles.kicker}>{kicker}</p>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.lead}>{lead}</p>
        {children}
        <p className={styles.note}>{note}</p>
    </section>
);

const TipShell = ({
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
        <TipShell label={String(label)} year={year}>
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
        </TipShell>
    );
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
        <TipShell label={String(label)} year={year}>
            {payload.map((entry) => {
                const series = TYPE_LINES.find((line) => line.key === entry.dataKey);
                const value = asNumber(entry.value);

                if (!series || value === null) {
                    return null;
                }

                const color = series.color ?? accent;

                return (
                    <div key={String(entry.dataKey)} className={styles.tooltipRow}>
                        <span className={styles.tooltipMuted}>{series.label}</span>
                        <span className={styles.tooltipNum} style={{ color }}>
                            {value}%
                        </span>
                    </div>
                );
            })}
        </TipShell>
    );
};

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
        <TipShell label={String(label)} year={year}>
            <div className={styles.tooltipRow}>
                <span className={styles.tooltipMuted}>Tempo-Vorfälle je 1.000 km</span>
                <span
                    className={styles.tooltipNum}
                    style={{ color: CHART_SERIES.km }}
                >
                    {row.eventsPer1000km ?? "—"}
                </span>
            </div>
            <div className={styles.tooltipRow}>
                <span className={styles.tooltipMuted}>Davon deutlich über dem Limit</span>
                <span
                    className={styles.tooltipNum}
                    style={{ color: CHART_SERIES.speeding }}
                >
                    {row.highShare}%
                </span>
            </div>
            {row.eventsPer1000km === null ? (
                <p className={styles.tooltipHint}>
                    Keine gefahrenen Kilometer in diesem Monat
                </p>
            ) : null}
        </TipShell>
    );
};

const RateChart = ({
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
            kicker="Nur Tempo"
            title="Wie viele Fahrer waren zu schnell?"
            lead="Von allen Fahrern mit Fahrzeug: wie viel Prozent hatten in dem Monat mindestens einen Tempo-Verstoß. Ein Fahrer zählt einmal — egal ob er einmal oder zehnmal zu schnell war."
            note="Die gestrichelte Linie ist der Schnitt der Vormonate. Steigt die Kurve darüber, wird es ungewöhnlich."
        >
            <div className={styles.chartCompact}>
                <ResponsiveContainer width="100%" height="100%">
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
                </ResponsiveContainer>
            </div>
        </ChartCard>
    );
};

const TypeChart = ({
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
        >
            <div className={styles.chart}>
                <ResponsiveContainer width="100%" height="100%">
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
                </ResponsiveContainer>
            </div>
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
        </ChartCard>
    );
};

const KmChart = ({
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
            kicker="Pro Kilometer"
            title="Passiert das oft — oder nur, weil viel gefahren wird?"
            lead="Tempo-Vorfälle je 1.000 gefahrene Kilometer. Wenn die Flotte wächst oder mehr Touren fährt, bleibt die Zahl vergleichbar. Die Balken daneben: wie groß der Anteil der schweren Tempo-Vorfälle war."
            note="Die Monatssumme bleibt, auch wenn alte Fahrten (der Verlauf auf der Karte) gelöscht werden."
        >
            <div className={styles.chartCompact}>
                <ResponsiveContainer width="100%" height="100%">
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
                </ResponsiveContainer>
            </div>
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
        </ChartCard>
    );
};

export const BriefingCharts = ({
    history,
}: {
    history: BriefingHistoryMonth[];
}) => {
    const rateSeries = toRateSeries(history);
    const typeSeries = toTypeSeries(history);
    const kmSeries = toKmSeries(history);
    const year = historyYear(history);
    const baseline = baselineFromSeries(rateSeries);

    return (
        <div className={styles.section}>
            <TypeChart series={typeSeries} year={year} />
            <RateChart series={rateSeries} baseline={baseline} year={year} />
            <KmChart series={kmSeries} year={year} />
        </div>
    );
};
