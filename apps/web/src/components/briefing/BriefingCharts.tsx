import type { BriefingHistoryMonth } from "@fleet-live/shared";

import {
    historyYear,
    rateBaseline,
    toKmSeries,
    toRateSeries,
    toTypeSeries,
} from "./briefingChartSeries";
import { BriefingKmChart } from "./BriefingKmChart";
import { BriefingRateChart } from "./BriefingRateChart";
import { BriefingTypeChart } from "./BriefingTypeChart";
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

export const BriefingCharts = ({
    history,
}: {
    history: BriefingHistoryMonth[];
}) => {
    const rateSeries = toRateSeries(history);
    const typeSeries = toTypeSeries(history);
    const kmSeries = toKmSeries(history);
    const year = historyYear(history);
    const baseline = rateBaseline(rateSeries);
    const priorOf = <T,>(series: T[]) =>
        series.slice(0, Math.max(1, series.length - 1));
    const kmMean = seriesMean(
        priorOf(kmSeries).map((row) => row.eventsPer1000km),
    );
    const highShareMean = seriesMean(
        priorOf(typeSeries).map((row) => row.highShare),
    );
    const lowFuelMean = seriesMean(
        priorOf(typeSeries).map((row) => row.lowFuel),
    );
    const offlineMean = seriesMean(
        priorOf(typeSeries).map((row) => row.offline),
    );

    return (
        <>
            <div className={styles.section}>
                <BriefingTypeChart series={typeSeries} year={year} />
                <BriefingRateChart
                    series={rateSeries}
                    baseline={baseline}
                    year={year}
                />
                <BriefingKmChart series={kmSeries} year={year} />
            </div>
            <details className={styles.dataAlternative}>
                <summary>Exakte Monatswerte anzeigen</summary>
                <p className={styles.dataHint}>
                    Dieselben Kennzahlen wie in den Diagrammen. Rot und Gelb
                    liegen über dem Schnitt der Vormonate.
                </p>
                <div className={styles.dataTableWrap}>
                    <table>
                        <caption>Monatliche Flottenkennzahlen</caption>
                        <thead>
                            <tr>
                                <th>Monat</th>
                                <th>Aktive Fahrer</th>
                                <th>Fahrer mit Tempo-Verstoß</th>
                                <th>Je 1.000 km</th>
                                <th>Schwere Tempo-Verstöße</th>
                                <th>Wenig Tank</th>
                                <th>Ohne Signal</th>
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
                                const lowFuel =
                                    typeSeries[index]?.lowFuel ?? 0;
                                const offline =
                                    typeSeries[index]?.offline ?? 0;

                                return (
                                    <tr key={month.month}>
                                        <th scope="row">
                                            {formatMonth(month.month)}
                                        </th>
                                        <td>
                                            {formatCount(month.active_drivers)}
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
                                            {formatPercent(lowFuel)}
                                        </td>
                                        <td
                                            className={toneClass(
                                                offline,
                                                offlineMean,
                                                "danger",
                                            )}
                                        >
                                            {formatPercent(offline)}
                                        </td>
                                        <td>{formatKm(month.distance_m)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </details>
        </>
    );
};
