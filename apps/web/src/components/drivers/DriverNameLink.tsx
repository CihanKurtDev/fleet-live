import { type MouseEvent } from "react";
import { Link, useLocation } from "react-router";
import styles from "./DriverNameLink.module.scss";

export const DriverNameLink = ({
    driverId,
    name,
    className,
}: {
    driverId: number;
    name: string;
    className?: string;
}) => {
    const location = useLocation();

    return (
        <Link
            className={className ?? styles.link}
            to={`/drivers/${driverId}`}
            state={{
                from: `${location.pathname}${location.search}`,
            }}
            onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                event.stopPropagation();
            }}
        >
            {name}
        </Link>
    );
};
