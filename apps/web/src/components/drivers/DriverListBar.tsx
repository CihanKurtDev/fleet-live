import { Link, useSearchParams } from "react-router";
import { driverListQuerySchema } from "@fleet-live/shared";

import { driverListPath } from "./driverBoardView";
import styles from "./DriverBoard.module.scss";

/** Above the table view: back to the board, and the board filter if one is set. */
export const DriverListBar = () => {
    const [searchParams] = useSearchParams();
    const search = searchParams.get("search") ?? "";
    const parsed = driverListQuerySchema
        .pick({ min_open_warnings: true, without_vehicle: true })
        .safeParse({
            min_open_warnings: searchParams.get("min_open_warnings") ?? undefined,
            without_vehicle: searchParams.get("without_vehicle") ?? undefined,
        });
    const filter = parsed.success ? parsed.data : {};
    const labels = [
        filter.min_open_warnings !== undefined
            ? `ab ${filter.min_open_warnings} offenen Warnungen`
            : null,
        filter.without_vehicle ? "ohne aktuelles Fahrzeug" : null,
    ].filter((label): label is string => label !== null);

    return (
        <nav className={styles.listBar} aria-label="Fahreransicht">
            <Link to="/drivers">← Übersicht</Link>
            {labels.length > 0 && (
                <>
                    <span>Gefiltert: {labels.join(", ")}</span>
                    <Link to={driverListPath(search)}>Filter aufheben</Link>
                </>
            )}
        </nav>
    );
};
