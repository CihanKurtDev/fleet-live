import { Link } from "react-router";
import { dismissImportPrompt } from "../../api/auth";
import { Button } from "../ui/Button/Button";
import { useAuth } from "../../hooks/useAuth";
import styles from "./ImportPrompt.module.scss";

export const ImportPrompt = () => {
    const { user, setUser } = useAuth();

    if (!user?.import_prompt) {
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
                <Link className={styles.import} to="/vehicles/import">
                    Liste importieren
                </Link>
                <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
                    Schließen
                </Button>
            </div>
        </aside>
    );
};
