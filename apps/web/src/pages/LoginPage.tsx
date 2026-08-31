import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { login } from "../api/auth";
import { ApiError } from "../api/client";
import { Button } from "../components/ui/Button/Button";
import { useAuth } from "../hooks/useAuth";
import styles from "./LoginPage.module.scss";

export const LoginPage = () => {
    const navigate = useNavigate();
    const { setUser } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        setError(null);
        setFieldErrors({});

        try {
            setIsSubmitting(true);
            const user = await login({ email, password });
            setUser(user);
            navigate("/vehicles", { replace: true });
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

                <Link className={styles.back} to="/vehicles">
                    Ohne Anmeldung weiter
                </Link>
            </div>
        </section>
    );
};
