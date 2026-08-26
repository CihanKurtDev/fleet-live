import type { TableFilterWithCount } from "../../../types/table";
import styles from "./TableFilterBar.module.scss";

interface TableFilterBarProps<RowType> {
    filters: TableFilterWithCount<RowType>[];
    activeFilterId: string | null;
    onFilterChange: (filterId: string | null) => void;
}

export const TableFilterBar = <RowType,>({
    filters,
    activeFilterId,
    onFilterChange,
}: TableFilterBarProps<RowType>) => {
    if (filters.length === 0) {
        return null;
    }

    return (
        <div className={styles.filterBar} role="group">
            {filters.map((filter) => {
                const isActive =
                    filter.id === activeFilterId;

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
                            // Erneuter Klick auf den aktiven Filter hebt ihn auf.
                            onFilterChange(
                                isActive ? null : filter.id,
                            )
                        }
                    >
                        <span>{filter.displayText}</span>

                        <span className={styles.count}>
                            {filter.count}
                        </span>
                    </button>
                );
            })}
        </div>
    );
};
