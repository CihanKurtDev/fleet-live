import { type MouseEvent } from "react";
import { Link } from "react-router";

import { backLabel } from "./detailBack";
import { useDetailBack } from "./useDetailBack";
import styles from "./DetailBackLink.module.scss";

export const DetailBackLink = ({ fallback }: { fallback: string }) => {
    const { from, fromHistory, navigate } = useDetailBack(fallback);

    const handleBack = (event: MouseEvent<HTMLAnchorElement>) => {
        if (
            !fromHistory ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
        ) {
            return;
        }

        event.preventDefault();
        navigate(-1);
    };

    return (
        <Link className={styles.back} to={from} onClick={handleBack}>
            {backLabel(from)}
        </Link>
    );
};
