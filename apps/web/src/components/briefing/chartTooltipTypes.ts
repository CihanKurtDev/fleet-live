import type { KmMonth, RateMonth, TypeMonth } from "./briefingChartSeries";

export type TooltipRow = {
    dataKey?: string | number;
    value?: number | string | Array<number | string> | null;
    payload?: TypeMonth | RateMonth | KmMonth;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

export const isRateMonth = (value: unknown): value is RateMonth =>
    isRecord(value) &&
    typeof value.month === "string" &&
    typeof value.aktiveFahrer === "number" &&
    typeof value.verstoss === "number" &&
    typeof value.rate === "number";

export const isTypeMonth = (value: unknown): value is TypeMonth =>
    isRecord(value) &&
    typeof value.month === "string" &&
    typeof value.rate === "number" &&
    typeof value.lowFuel === "number" &&
    typeof value.offline === "number" &&
    typeof value.highShare === "number" &&
    !("verstoss" in value);

export const isKmMonth = (value: unknown): value is KmMonth =>
    isRecord(value) &&
    typeof value.month === "string" &&
    (value.eventsPer1000km === null ||
        typeof value.eventsPer1000km === "number") &&
    typeof value.highShare === "number" &&
    !("lowFuel" in value);
