import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { login } from "../api/auth";
import { ApiError } from "../api/client";
import { Button } from "../components/ui/Button/Button";
import { useAuth } from "../hooks/useAuth";
import styles from "./LoginPage.module.scss";

export const LoginPage = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { user, setUser } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [remember, setRemember] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        setError(null);
        setFieldErrors({});

        try {
            setIsSubmitting(true);
            const user = await login({ email, password, remember });
            setUser(user);
            const from = (
                location.state as {
                    from?: { pathname: string; search: string };
                } | null
            )?.from;
            const next =
                from && from.pathname !== "/login"
                    ? `${from.pathname}${from.search}`
                    : "/vehicles";
            navigate(next, { replace: true });
        } catch (caught: unknown) {
            if (caught instanceof ApiError) {
                setError(caught.message);
                setFieldErrors(caught.fields ?? {});
                return;
            }

            if (caught instanceof Error) {
                setError(caught.message);
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const emailError = fieldErrors.email;
    const passwordError = fieldErrors.password;
    const formError =
        error && !emailError && !passwordError ? error : null;

    if (user) {
        return <Navigate to="/vehicles" replace />;
    }

    return (
        <section className={styles.page}>
            <div className={styles.card}>
                <header className={styles.header}>
                    <h1 className={styles.title}>Anmelden</h1>
                    <p className={styles.lead}>
                        Melde dich mit deinem Konto an.
                    </p>
                </header>

                <form className={styles.form} onSubmit={handleSubmit}>
                    <div className={styles.field}>
                        <label htmlFor="login-email">E-Mail</label>
                        <input
                            id="login-email"
                            type="email"
                            autoComplete="username"
                            autoFocus
                            required
                            value={email}
                            aria-invalid={Boolean(emailError)}
                            aria-describedby={
                                emailError ? "login-email-error" : undefined
                            }
                            onChange={(event) => setEmail(event.target.value)}
                        />
                        {emailError && (
                            <p
                                id="login-email-error"
                                className={styles.error}
                            >
                                {emailError}
                            </p>
                        )}
                    </div>
                    <div className={styles.field}>
                        <label htmlFor="login-password">Passwort</label>
                        <input
                            id="login-password"
                            type="password"
                            autoComplete="current-password"
                            required
                            value={password}
                            aria-invalid={Boolean(passwordError)}
                            aria-describedby={
                                passwordError
                                    ? "login-password-error"
                                    : undefined
                            }
                            onChange={(event) =>
                                setPassword(event.target.value)
                            }
                        />
                        {passwordError && (
                            <p
                                id="login-password-error"
                                className={styles.error}
                            >
                                {passwordError}
                            </p>
                        )}
                    </div>
                    <label className={styles.remember}>
                        <input
                            type="checkbox"
                            checked={remember}
                            onChange={(event) =>
                                setRemember(event.target.checked)
                            }
                        />
                        Angemeldet bleiben
                    </label>
                    {formError && (
                        <p className={styles.banner} role="alert">
                            {formError}
                        </p>
                    )}
                    <Button
                        type="submit"
                        fullWidth
                        size="lg"
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? "Wird angemeldet…" : "Anmelden"}
                    </Button>
                </form>
                {import.meta.env.DEV && (
                    <aside className={styles.hint}>
                        <p className={styles.hintTitle}>Demo-Zugang</p>
                        <p>
                            <span>E-Mail</span> cihan@example.com
                        </p>
                        <p>
                            <span>Passwort</span> development-only-password
                        </p>
                        <p>
                            <span>Nur lesen</span> viewer@example.com
                        </p>
                        <div className={styles.hintActions}>
                            <button
                                type="button"
                                className={styles.hintFill}
                                onClick={() => {
                                    setEmail("cihan@example.com");
                                    setPassword("development-only-password");
                                }}
                            >
                                Dispatcher übernehmen
                            </button>
                            <button
                                type="button"
                                className={styles.hintFill}
                                onClick={() => {
                                    setEmail("viewer@example.com");
                                    setPassword("development-only-password");
                                }}
                            >
                                Viewer übernehmen
                            </button>
                        </div>
                    </aside>
                )}
            </div>
        </section>
    );
};
