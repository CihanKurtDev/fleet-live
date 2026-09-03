import { type MouseEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import styles from "./DetailBackLink.module.scss";

export const readBackTarget = (
    state: unknown,
    fallback: string,
): { from: string; fromHistory: boolean } => {
    if (
        typeof state === "object" &&
        state !== null &&
        "from" in state &&
        typeof state.from === "string"
    ) {
        return { from: state.from, fromHistory: true };
    }

    return { from: fallback, fromHistory: false };
};

export const backLabel = (from: string): string => {
    if (from.startsWith("/fleet")) {
        return "Zurück zur Karte";
    }

    if (from.startsWith("/alerts")) {
        return "Zurück zu den Warnungen";
    }

    return "Zurück zur Übersicht";
};

export const useDetailBack = (fallback: string) => {
    const location = useLocation();
    const navigate = useNavigate();
    const { from, fromHistory } = readBackTarget(location.state, fallback);

    return { from, fromHistory, navigate };
};

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
