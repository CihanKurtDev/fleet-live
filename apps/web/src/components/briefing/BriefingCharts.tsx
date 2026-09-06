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
import styles from "./BriefingCharts.module.scss";

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

    return (
        <div className={styles.section}>
            <BriefingTypeChart series={typeSeries} year={year} />
            <BriefingRateChart series={rateSeries} baseline={baseline} year={year} />
            <BriefingKmChart series={kmSeries} year={year} />
        </div>
    );
};
