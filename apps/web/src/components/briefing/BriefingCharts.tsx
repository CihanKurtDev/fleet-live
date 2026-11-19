import { useRef, useState } from "react";
import { berlinTodayIso, type BriefingHistoryMonth } from "@fleet-live/shared";

import {
    HIGH_SHARE_LABEL,
    historyYear,
    rateBaseline,
    toKmSeries,
    toRateSeries,
    toTypeSeries,
    withoutEmptyStart,
} from "./briefingChartSeries";
import { BriefingKmChart } from "./BriefingKmChart";
import { BriefingRateChart } from "./BriefingRateChart";
import { formatCount } from "../../utils/formatCount";
import styles from "./BriefingCharts.module.scss";

const formatPercent = (value: number) =>
    `${value.toLocaleString("de-DE", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
    })} %`;

const formatRate = (value: number | null) =>
    value === null
        ? "—"
        : value.toLocaleString("de-DE", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
          });

const formatKm = (distanceM: number) =>
    formatCount(Math.round(distanceM / 1_000));

const formatMonth = (month: string) => {
    const date = new Date(`${month}-01T00:00:00Z`);

    return Number.isNaN(date.getTime())
        ? month
        : new Intl.DateTimeFormat("de-DE", {
              month: "short",
              year: "numeric",
              timeZone: "UTC",
          }).format(date);
};

const seriesMean = (values: Array<number | null | undefined>) => {
    const numbers = values.filter(
        (value): value is number => typeof value === "number",
    );

    if (numbers.length === 0) {
        return 0;
    }

    return numbers.reduce((total, value) => total + value, 0) / numbers.length;
};

const toneClass = (
    value: number | null | undefined,
    threshold: number,
    tone: "danger" | "warning",
) =>
    value != null && value > threshold
        ? tone === "danger"
            ? styles.cellDanger
            : styles.cellWarning
        : undefined;

/**
 * The month view of Schicht: two charts and the exact month values, folded
 * away, because they decide nothing for the shift. The monthly type figures
 * that once had their own chart are in the month table.
 */
export const BriefingCharts = ({ history: allMonths }: { history: BriefingHistoryMonth[] }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDetailsElement>(null);
    const history = withoutEmptyStart(allMonths);
    // The current month is not over yet: its figures are not a full month.
    const running = berlinTodayIso().slice(0, 7);
    const hasRunning = history.some((month) => month.month === running);
    const finished = history.filter((month) => month.month !== running);
    const chartRate = toRateSeries(finished);
    const chartKm = toKmSeries(finished);
    const rateSeries = toRateSeries(history);
    const typeSeries = toTypeSeries(history);
    const kmSeries = toKmSeries(history);
    const year = historyYear(history);
    const baseline = rateBaseline(rateSeries);
    const chartBaseline = rateBaseline(chartRate);
    const priorOf = <T,>(series: T[]) =>
        series.slice(0, Math.max(1, series.length - 1));
    const kmMean = seriesMean(
        priorOf(kmSeries).map((row) => row.eventsPer1000km),
    );
    const highShareMean = seriesMean(
        priorOf(typeSeries).map((row) => row.highShare),
    );
    // Months before the first trip are no baseline: their 0 would make
    // every later month look above average.
    const drivenBefore = priorOf(history).filter((month) => month.distance_m > 0);
    const lowFuelMean = seriesMean(
        drivenBefore.map((month) => month.low_fuel_vehicles),
    );
    const offlineMean = seriesMean(
        drivenBefore.map((month) => month.offline_vehicles),
    );

    return (
        <details
            ref={ref}
            className={styles.dataAlternative}
            onToggle={(event) => {
                const isOpen = event.currentTarget.open;
                setOpen(isOpen);
                // It opens below the window: bring it up.
                if (isOpen) {
                    requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
                }
            }}
        >
            <summary>{open ? "Monatswerte und Verlauf ausblenden" : "Monatswerte und Verlauf anzeigen"}</summary>
            <div className={styles.section}>
                <BriefingRateChart
                    series={chartRate}
                    baseline={chartBaseline}
                    year={year}
                    empty={finished.every((month) => month.active_drivers === 0)}
                />
                <BriefingKmChart
                    series={chartKm}
                    year={year}
                    empty={finished.every((month) => month.distance_m === 0)}
                />
            </div>
            <p className={styles.dataHint}>
                Dieselben Kennzahlen wie in den Diagrammen. Rot und Gelb
                liegen über dem Schnitt der Vormonate.
                {hasRunning && ` ${formatMonth(running)} läuft noch: Kilometer und Zahlen sind kein ganzer Monat; die Diagramme zeigen nur abgeschlossene Monate.`}
            </p>
            <div className={styles.dataTableWrap}>
                <table>
                    <caption>Monatliche Flottenkennzahlen</caption>
                    <thead>
                        <tr>
                            <th>Monat</th>
                            <th>Aktive Fahrer</th>
                            <th>Fahrer mit Tempo-Warnung</th>
                            <th>Tempo-Warnungen je 1.000 km</th>
                            <th>{HIGH_SHARE_LABEL}</th>
                            <th>Fahrzeuge mit wenig Tank</th>
                            <th>Fahrzeuge ohne Signal</th>
                            <th>Gefahrene km</th>
                        </tr>
                    </thead>
                    <tbody>
                        {history.map((month, index) => {
                            const rate = rateSeries[index]?.rate ?? 0;
                            const perKm =
                                kmSeries[index]?.eventsPer1000km ??
                                null;
                            const highShare =
                                typeSeries[index]?.highShare ?? 0;
                            const lowFuel = month.low_fuel_vehicles;
                            const offline = month.offline_vehicles;

                            return (
                                <tr key={month.month}>
                                    <th scope="row">
                                        {formatMonth(month.month)}
                                        {month.month === running && " (läuft)"}
                                    </th>
                                    <td>
                                        {month.active_drivers === null ? "—" : formatCount(month.active_drivers)}
                                    </td>
                                    <td
                                        className={toneClass(
                                            rate,
                                            baseline,
                                            "danger",
                                        )}
                                    >
                                        {formatPercent(rate)}
                                    </td>
                                    <td
                                        className={toneClass(
                                            perKm,
                                            kmMean,
                                            "danger",
                                        )}
                                    >
                                        {formatRate(perKm)}
                                    </td>
                                    <td
                                        className={toneClass(
                                            highShare,
                                            highShareMean,
                                            "danger",
                                        )}
                                    >
                                        {formatPercent(highShare)}
                                    </td>
                                    <td
                                        className={toneClass(
                                            lowFuel,
                                            lowFuelMean,
                                            "warning",
                                        )}
                                    >
                                        {formatCount(lowFuel)}
                                    </td>
                                    <td
                                        className={toneClass(
                                            offline,
                                            offlineMean,
                                            "danger",
                                        )}
                                    >
                                        {formatCount(offline)}
                                    </td>
                                    <td>{formatKm(month.distance_m)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </details>
    );
};
