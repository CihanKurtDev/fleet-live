import { useId } from "react";
import { getPageWindow } from "../../../utils/getPageWindow";
import styles from "./TablePagination.module.scss";

const LIMIT_OPTIONS = [10, 25, 50, 100];

interface ChevronProps {
    direction: "left" | "right";
    double?: boolean;
}

const Chevron = ({
    direction,
    double = false,
}: ChevronProps) => (
    <svg
        className={
            direction === "left"
                ? styles.chevron
                : `${styles.chevron} ${styles.chevronFlipped}`
        }
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
    >
        {double ? (
            <>
                <path d="m11 17-5-5 5-5" />
                <path d="m18 17-5-5 5-5" />
            </>
        ) : (
            <path d="m15 18-6-6 6-6" />
        )}
    </svg>
);

interface TablePaginationProps {
    page: number;
    pageCount: number;
    limit: number;

    /** Gesamtzahl der Zeilen nach Suche und Filter. */
    total: number;

    onPageChange: (page: number) => void;
    onLimitChange: (limit: number) => void;
}

export const TablePagination = ({
    page,
    pageCount,
    limit,
    total,
    onPageChange,
    onLimitChange,
}: TablePaginationProps) => {
    const limitSelectId = useId();

    const isFirstPage = page <= 1;
    const isLastPage = page >= pageCount;

    const firstRow = total === 0 ? 0 : (page - 1) * limit + 1;
    const lastRow = Math.min(page * limit, total);

    // Nur Optionen anbieten, die zur Datenmenge passen:
    // die kleinste, alle die noch etwas ändern, und die aktuelle.
    const limitOptions = LIMIT_OPTIONS.filter(
        (option, index) => {
            const previous = LIMIT_OPTIONS[index - 1];

            return (
                option === limit ||
                previous === undefined ||
                previous < total
            );
        },
    );

    const pageItems = getPageWindow(page, pageCount);

    return (
        <div className={styles.pagination}>
            <div className={styles.limit}>
                <select
                    id={limitSelectId}
                    className={styles.limitSelect}
                    value={limit}
                    onChange={(event) =>
                        onLimitChange(
                            Number(event.target.value),
                        )
                    }
                >
                    {limitOptions.map((option) => (
                        <option key={option} value={option}>
                            {option}
                        </option>
                    ))}
                </select>

                <label htmlFor={limitSelectId}>
                    pro Seite
                </label>
            </div>

            <nav
                className={styles.pages}
                aria-label="Seitennavigation"
            >
                <button
                    type="button"
                    className={styles.pageButton}
                    aria-label="Erste Seite"
                    disabled={isFirstPage}
                    onClick={() => onPageChange(1)}
                >
                    <Chevron direction="left" double />
                </button>

                <button
                    type="button"
                    className={styles.pageButton}
                    aria-label="Vorherige Seite"
                    disabled={isFirstPage}
                    onClick={() => onPageChange(page - 1)}
                >
                    <Chevron direction="left" />
                </button>

                {pageItems.map((item) =>
                    typeof item === "number" ? (
                        <button
                            key={item}
                            type="button"
                            className={
                                item === page
                                    ? `${styles.pageButton} ${styles.pageButtonActive}`
                                    : styles.pageButton
                            }
                            aria-label={`Seite ${item}`}
                            aria-current={
                                item === page
                                    ? "page"
                                    : undefined
                            }
                            onClick={() => onPageChange(item)}
                        >
                            {item}
                        </button>
                    ) : (
                        <span
                            key={item}
                            className={styles.ellipsis}
                            aria-hidden="true"
                        >
                            …
                        </span>
                    ),
                )}

                <button
                    type="button"
                    className={styles.pageButton}
                    aria-label="Nächste Seite"
                    disabled={isLastPage}
                    onClick={() => onPageChange(page + 1)}
                >
                    <Chevron direction="right" />
                </button>

                <button
                    type="button"
                    className={styles.pageButton}
                    aria-label="Letzte Seite"
                    disabled={isLastPage}
                    onClick={() => onPageChange(pageCount)}
                >
                    <Chevron direction="right" double />
                </button>
            </nav>

            <p className={styles.range}>
                {firstRow}-{lastRow} von {total}
            </p>
        </div>
    );
};
