import type { TableFilterWithCount } from "../../../types/table";
import { formatCount } from "../../../utils/formatCount";
import styles from "./TableFilterBar.module.scss";

interface TableFilterBarProps<RowType> {
    filters: TableFilterWithCount<RowType>[];
    activeFilterId: string | null;
    onFilterChange: (filterId: string | null) => void;
    allCount?: number;
}

export const TableFilterBar = <RowType,>({
    filters,
    activeFilterId,
    onFilterChange,
    allCount,
}: TableFilterBarProps<RowType>) => {
    if (filters.length === 0) {
        return null;
    }

    const allActive = activeFilterId === null;

    return (
        <div className={styles.filterBar} role="group" aria-label="Statusfilter">
            {allCount !== undefined && (
                <button
                    type="button"
                    className={
                        allActive
                            ? `${styles.chip} ${styles.chipActive}`
                            : styles.chip
                    }
                    aria-pressed={allActive}
                    onClick={() => onFilterChange(null)}
                >
                    <span>Alle</span>
                    <span className={styles.count}>
                        {formatCount(allCount)}
                    </span>
                </button>
            )}
            {filters.map((filter) => {
                const isActive = filter.id === activeFilterId;

                return (
                    <button
                        key={filter.id}
                        type="button"
                        className={
                            isActive
                                ? `${styles.chip} ${styles.chipActive}`
                                : styles.chip
                        }
                        aria-pressed={isActive}
                        onClick={() =>
                            onFilterChange(isActive ? null : filter.id)
                        }
                    >
                        <span>{filter.displayText}</span>
                        <span className={styles.count}>
                            {formatCount(filter.count)}
                        </span>
                    </button>
                );
            })}
        </div>
    );
};
