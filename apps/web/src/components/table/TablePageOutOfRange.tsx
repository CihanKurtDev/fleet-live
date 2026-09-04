import type { ReactNode } from "react";
import { Button } from "../ui/Button/Button";
import styles from "./TablePageOutOfRange.module.scss";

type TablePageOutOfRangeProps = {
    page: number;
    pageCount: number;
    onGoToLast: () => void;
    onGoToFirst: () => void;
};

export const TablePageOutOfRange = ({
    page,
    pageCount,
    onGoToLast,
    onGoToFirst,
}: TablePageOutOfRangeProps): ReactNode => (
    <div className={styles.outOfRange}>
        <p>
            Seite {page} gibt es nicht. Es gibt {pageCount}{" "}
            {pageCount === 1 ? "Seite." : "Seiten."}
        </p>
        <div className={styles.outOfRangeActions}>
            <Button variant="primary" size="sm" onClick={onGoToLast}>
                Zur letzten Seite
            </Button>
            {pageCount > 1 && (
                <Button variant="secondary" size="sm" onClick={onGoToFirst}>
                    Zur ersten Seite
                </Button>
            )}
        </div>
    </div>
);
