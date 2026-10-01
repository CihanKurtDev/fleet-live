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
            <p>
                Die Firma hat noch keine Fahrzeuge. Stammdaten kannst du
                jetzt importieren.
            </p>
            <div className={styles.actions}>
                <Link to="/vehicles/import">Importieren</Link>
                <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
                    Später
                </Button>
            </div>
        </aside>
    );
};
