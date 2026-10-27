import { useEffect } from "react";
import { Link } from "react-router";
import { dismissImportPrompt, getMe } from "../../api/auth";
import { Button } from "../ui/Button/Button";
import { buttonClass } from "../ui/Button/buttonClass";
import { useAuth } from "../../hooks/useAuth";
import styles from "./ImportPrompt.module.scss";

/**
 * One-time question on Schicht for a dispatcher of an empty company.
 * `user.import_prompt` is read at sign-in; `companyEmpty` comes from the
 * live briefing, so the banner goes as soon as vehicles exist, and a
 * company that became empty after sign-in asks the server again once.
 */
export const ImportPrompt = ({ companyEmpty }: { companyEmpty: boolean }) => {
    const { user, setUser } = useAuth();
    const stale =
        companyEmpty && user?.role === "dispatcher" && !user.import_prompt;

    useEffect(() => {
        if (!stale) {
            return;
        }

        // A dismissed prompt stays false here, so this runs once, not in a loop.
        void getMe()
            .then(setUser)
            .catch(() => undefined);
    }, [stale, setUser]);

    if (!user?.import_prompt || !companyEmpty) {
        return null;
    }

    const dismiss = async () => {
        const next = await dismissImportPrompt();
        setUser(next);
    };

    return (
        <aside className={styles.banner}>
            <div className={styles.copy}>
                <h2>Noch keine Fahrzeuge</h2>
                <p>
                    Diese Firma ist noch leer. Eine Liste aus CSV oder Excel
                    kannst du importieren. Einzelne Fahrzeuge legst du unter
                    Fahrzeuge an.
                </p>
            </div>
            <div className={styles.actions}>
                <Link
                    className={buttonClass("primary", "toolbar")}
                    to="/vehicles/import"
                >
                    Bestand importieren
                </Link>
                <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
                    Schließen
                </Button>
            </div>
        </aside>
    );
};
