import type { BriefingHistoryMonth } from "@fleet-live/shared";

const MONTH_LABELS = [
    "Jan",
    "Feb",
    "Mär",
    "Apr",
    "Mai",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Okt",
    "Nov",
    "Dez",
] as const;

export const CHART_SERIES = {
    speeding: "#dc2626",
    lowFuel: "#d97706",
    offline: "#64748b",
    km: "#0f766e",
} as const;

const pct = (numerator: number, denominator: number) => {
    if (denominator <= 0) {
        return 0;
    }

    return Number(((numerator / denominator) * 100).toFixed(1));
};

const monthLabel = (month: string) => {
    const index = Number(month.slice(5, 7)) - 1;
    return MONTH_LABELS[index] ?? month;
};

export type RateMonth = {
    month: string;
    aktiveFahrer: number;
    verstoss: number;
    rate: number;
};

export type TypeMonth = {
    month: string;
    rate: number;
    lowFuel: number;
    offline: number;
    highShare: number;
};

export type KmMonth = {
    month: string;
    eventsPer1000km: number | null;
    highShare: number;
};

export const toRateSeries = (history: BriefingHistoryMonth[]): RateMonth[] =>
    history.map((row) => ({
        month: monthLabel(row.month),
        aktiveFahrer: row.active_drivers,
        verstoss: row.speeding_drivers,
        rate: pct(row.speeding_drivers, row.active_drivers),
    }));

export const toTypeSeries = (history: BriefingHistoryMonth[]): TypeMonth[] =>
    history.map((row) => ({
        month: monthLabel(row.month),
        rate: pct(row.speeding_drivers, row.active_drivers),
        lowFuel: pct(row.low_fuel_vehicles, row.active_vehicles),
        offline: pct(row.offline_vehicles, row.active_vehicles),
        highShare: pct(row.speeding_high, row.speeding_events),
    }));

export const toKmSeries = (history: BriefingHistoryMonth[]): KmMonth[] =>
    history.map((row) => {
        const km = row.distance_m / 1000;
        const eventsPer1000km =
            km <= 0
                ? null
                : Number(((row.speeding_events / km) * 1000).toFixed(2));

        return {
            month: monthLabel(row.month),
            eventsPer1000km,
            highShare: pct(row.speeding_high, row.speeding_events),
        };
    });

export const rateBaseline = (series: RateMonth[]) => {
    if (series.length === 0) {
        return 0;
    }

    const prior = series.slice(0, Math.max(1, series.length - 1));
    const sum = prior.reduce((total, row) => total + row.rate, 0);
    return Number((sum / prior.length).toFixed(1));
};

export const firstKmMonth = (series: KmMonth[]) => {
    const index = series.findIndex((row) => row.eventsPer1000km !== null);
    return index > 0 ? series[index]?.month : undefined;
};

export const yCeiling = (values: number[], min = 8, step = 5) => {
    const peak = Math.max(min, ...values, 0);
    return Math.ceil((peak * 1.15) / step) * step;
};

export const historyYear = (history: BriefingHistoryMonth[]) => {
    const first = history[0]?.month;
    return first ? first.slice(0, 4) : String(new Date().getUTCFullYear());
};
