import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { resetPassword } from "../api/auth";
import { ApiError } from "../api/client";
import { Button } from "../components/ui/Button/Button";
import { Input } from "../components/ui/Input/Input";
import styles from "./LoginPage.module.scss";

export const ResetPasswordPage = () => {
    const [params] = useSearchParams();
    const token = params.get("token") ?? "";
    const [password, setPassword] = useState("");
    const [done, setDone] = useState(false);
    const [error, setError] = useState<string | null>(
        token ? null : "Der Link ist ungültig oder abgelaufen.",
    );
    const [pending, setPending] = useState(false);

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setPending(true);
        setError(null);

        try {
            await resetPassword(token, password);
            setDone(true);
        } catch (caught: unknown) {
            setError(
                caught instanceof ApiError
                    ? caught.message
                    : "Das Passwort konnte nicht gesetzt werden.",
            );
        } finally {
            setPending(false);
        }
    };

    return (
        <section className={styles.page}>
            <div className={styles.card}>
                <header className={styles.header}>
                    <h1 className={styles.title}>Neues Passwort</h1>
                    <p className={styles.lead}>
                        Mindestens 12, höchstens 128 Zeichen. Alle bisherigen
                        Anmeldungen enden.
                    </p>
                </header>
                {done ? (
                    <p className={styles.lead}>
                        Das Passwort ist gesetzt. Du kannst dich anmelden.
                    </p>
                ) : (
                    <form className={styles.form} onSubmit={submit}>
                        <div className={styles.field}>
                            <label htmlFor="password">Neues Passwort</label>
                            <Input
                                id="password"
                                type="password"
                                size="lg"
                                fullWidth
                                required
                                minLength={12}
                                maxLength={128}
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                            />
                        </div>
                        {error && (
                            <p className={styles.banner} role="alert">
                                {error}
                            </p>
                        )}
                        <Button
                            type="submit"
                            fullWidth
                            size="lg"
                            disabled={pending || !token}
                        >
                            Passwort setzen
                        </Button>
                    </form>
                )}
                <p className={styles.links}>
                    <Link to="/login">Zur Anmeldung</Link>
                </p>
            </div>
        </section>
    );
};
