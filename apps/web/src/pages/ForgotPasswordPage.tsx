import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { forgotPassword } from "../api/auth";
import { ApiError } from "../api/client";
import { Button } from "../components/ui/Button/Button";
import { Input } from "../components/ui/Input/Input";
import styles from "./LoginPage.module.scss";

export const ForgotPasswordPage = () => {
    const [email, setEmail] = useState("");
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setError(null);
        setPending(true);

        try {
            const result = await forgotPassword(email);
            setMessage(result.message);
        } catch (caught: unknown) {
            setError(
                caught instanceof ApiError
                    ? caught.message
                    : "Die Anfrage ist fehlgeschlagen.",
            );
        } finally {
            setPending(false);
        }
    };

    return (
        <section className={styles.page}>
            <div className={styles.card}>
                <header className={styles.header}>
                    <h1 className={styles.title}>Passwort vergessen</h1>
                    <p className={styles.lead}>
                        Wenn ein Konto mit Passwort existiert, gibt es einen
                        Link. Der gilt eine Stunde und nur einmal. Ohne
                        eingerichteten Mailversand landet er im Server-Log,
                        nicht im Posteingang.
                    </p>
                </header>
                {message ? (
                    <p className={styles.notice} role="status">
                        {message}
                    </p>
                ) : (
                    <form className={styles.form} onSubmit={submit}>
                        <div className={styles.field}>
                            <label htmlFor="email">E-Mail</label>
                            <Input
                                id="email"
                                type="email"
                                size="lg"
                                fullWidth
                                required
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                            />
                        </div>
                        {error && (
                            <p className={styles.banner} role="alert">
                                {error}
                            </p>
                        )}
                        <Button type="submit" fullWidth size="lg" disabled={pending}>
                            Link anfordern
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
