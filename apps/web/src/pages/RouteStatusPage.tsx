import { Link, isRouteErrorResponse, useRouteError } from "react-router";
import { Button } from "../components/ui/Button/Button";
import styles from "./RouteStatusPage.module.scss";

export const NotFoundPage = () => (
    <section className={styles.page}>
        <h1 className={styles.title}>Seite nicht gefunden</h1>
        <p className={styles.message}>
            Die aufgerufene Seite gibt es nicht oder sie wurde verschoben.
        </p>
        <div className={styles.actions}>
            <Link className={styles.link} to="/">
                Zur Schicht
            </Link>
        </div>
    </section>
);

export const RouteErrorPage = () => {
    const error = useRouteError();
    const notFound = isRouteErrorResponse(error) && error.status === 404;

    return (
        <section className={styles.page} role="alert">
            <h1 className={styles.title}>
                {notFound
                    ? "Seite nicht gefunden"
                    : "Seite konnte nicht geladen werden"}
            </h1>
            <p className={styles.message}>
                {notFound
                    ? "Die aufgerufene Seite gibt es nicht oder sie wurde verschoben."
                    : "Ein unerwarteter Fehler ist aufgetreten. Lade die Seite erneut oder gehe zurück zur Schicht."}
            </p>
            <div className={styles.actions}>
                {!notFound && (
                    <Button onClick={() => window.location.reload()}>
                        Erneut laden
                    </Button>
                )}
                <Link className={styles.link} to="/">
                    Zur Schicht
                </Link>
            </div>
        </section>
    );
};
