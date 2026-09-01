import type { TableFilter } from "../../../types/table";
import { formatCount } from "../../../utils/formatCount";
import styles from "./TableFilterBar.module.scss";

interface TableFilterBarProps<RowType> {
    filters: Array<TableFilter<RowType> & { count?: number }>;
    activeFilterId: string | null;
    onFilterChange: (filterId: string | null) => void;
    allCount?: number;
    allLabel?: string;
    groupLabel?: string;
    ariaLabel?: string;
    showAll?: boolean;
    className?: string;
}

export const TableFilterBar = <RowType,>({
    filters,
    activeFilterId,
    onFilterChange,
    allCount,
    allLabel = "Alle",
    groupLabel,
    ariaLabel = "Statusfilter",
    showAll,
    className,
}: TableFilterBarProps<RowType>) => {
    if (filters.length === 0) {
        return null;
    }

    const includeAll = showAll ?? allCount !== undefined;
    const allActive = activeFilterId === null;

    return (
        <div className={className ? `${styles.group} ${className}` : styles.group}>
            {groupLabel && <p className={styles.groupLabel}>{groupLabel}</p>}
            <div className={styles.filterBar} role="group" aria-label={ariaLabel}>
                {includeAll && (
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
                        <span>{allLabel}</span>
                        {allCount !== undefined && (
                            <span className={styles.count}>
                                {formatCount(allCount)}
                            </span>
                        )}
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
                            {filter.count !== undefined && (
                                <span className={styles.count}>
                                    {formatCount(filter.count)}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
