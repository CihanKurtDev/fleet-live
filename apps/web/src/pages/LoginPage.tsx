import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router";
import QRCode from "qrcode";
import {
    isLoginChallenge,
    type LoginChallenge,
    type SsoProviders,
} from "@fleet-live/shared";
import {
    confirmTotp,
    discoverCompanySso,
    getSsoProviders,
    login,
    resendVerification,
    setupTotp,
    startSsoLink,
} from "../api/auth";
import { ApiError } from "../api/client";
import { Button } from "../components/ui/Button/Button";
import { Checkbox } from "../components/ui/Checkbox/Checkbox";
import { FieldError } from "../components/ui/FieldError/FieldError";
import { fieldAria } from "../components/ui/FieldError/fieldAria";
import { Input } from "../components/ui/Input/Input";
import { useAuth } from "../hooks/useAuth";
import { usePageTitle } from "../hooks/usePageTitle";
import styles from "./LoginPage.module.scss";

const loginRedirectPath = (location: {
    state: unknown;
}): string => {
    const from = (
        location.state as {
            from?: { pathname: string; search: string };
        } | null
    )?.from;

    if (from && from.pathname !== "/login") {
        return `${from.pathname}${from.search}`;
    }

    return "/";
};

const ssoHint = (value: string | null) => {
    if (value === "unknown") {
        return "Dieser Login ist mit keinem Konto verknüpft. Melde dich mit Passwort an.";
    }

    if (value === "company") {
        return "Diese Firma meldet sich über den Firmen-Login an.";
    }

    if (value === "taken") {
        return "Dieser Firmen-Login gehört schon zu einem anderen Konto.";
    }

    if (value === "mismatch") {
        return "Der Firmen-Login meldet eine andere oder unbestätigte E-Mail.";
    }

    if (value === "unconfigured") {
        return "Dieser Login ist hier nicht konfiguriert.";
    }

    if (value === "error") {
        return "Der Firmen-Login ist fehlgeschlagen.";
    }

    return null;
};

/**
 * The second-factor step an identity provider hands back after its login
 * (`/login#challenge=…&step=…`). The fragment never reaches a server; it is
 * removed from the address at once.
 */
const challengeFromHash = (fragment: string): LoginChallenge | null => {
    const hash = new URLSearchParams(fragment.replace(/^#/, ""));
    const challenge = hash.get("challenge");
    const step = hash.get("step");

    if (!challenge || (step !== "totp" && step !== "totp_enroll")) {
        return null;
    }

    return { step, challenge };
};

export const LoginPage = () => {
    usePageTitle("Anmelden");
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const { user, setUser } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [remember, setRemember] = useState(false);
    const [code, setCode] = useState("");
    const [challenge, setChallenge] = useState<LoginChallenge | null>(() =>
        challengeFromHash(location.hash),
    );
    const [error, setError] = useState<string | null>(ssoHint(searchParams.get("sso")));
    const [info, setInfo] = useState<string | null>(
        searchParams.get("einladung") === "angenommen"
            ? "Einladung angenommen. Melde dich jetzt an."
            : null,
    );
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [unverified, setUnverified] = useState(false);
    const [qr, setQr] = useState<string | null>(null);
    const [providers, setProviders] = useState<SsoProviders>({
        google: false,
        microsoft: false,
    });

    // The step from the fragment is in state now; it leaves the address bar
    // and the history entry.
    useEffect(() => {
        if (location.hash.includes("challenge=")) {
            navigate(
                { pathname: location.pathname, search: location.search },
                { replace: true },
            );
        }
    }, [location.hash, location.pathname, location.search, navigate]);

    useEffect(() => {
        let cancelled = false;
        getSsoProviders()
            .then((next) => {
                if (!cancelled) {
                    setProviders(next);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setProviders({ google: false, microsoft: false });
                }
            });

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (challenge?.step !== "totp_enroll") {
            return;
        }

        let cancelled = false;
        setupTotp(challenge.challenge)
            .then(async (setup) => {
                if (cancelled) {
                    return;
                }

                setInfo(
                    `Schlüssel für die Authenticator-App: ${setup.secret}`,
                );
                setQr(
                    await QRCode.toDataURL(setup.otpauth_url, {
                        margin: 1,
                        width: 180,
                    }),
                );
            })
            .catch((caught: unknown) => {
                if (cancelled) {
                    return;
                }

                setError(
                    caught instanceof Error
                        ? caught.message
                        : "Zwei-Faktor konnte nicht gestartet werden.",
                );
            });

        return () => {
            cancelled = true;
        };
    }, [challenge]);

    const finish = (next: { id: number }) => {
        setUser(next as typeof user);
        navigate(loginRedirectPath(location), { replace: true });
    };

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        setError(null);
        setInfo(null);
        setFieldErrors({});
        setUnverified(false);

        try {
            setIsSubmitting(true);

            if (challenge) {
                const signedIn = await confirmTotp({
                    challenge: challenge.challenge,
                    code,
                });
                finish(signedIn);
                return;
            }

            const result = await login({ email, password, remember });

            if (isLoginChallenge(result)) {
                setChallenge(result);
                return;
            }

            finish(result);
        } catch (caught: unknown) {
            if (
                caught instanceof ApiError &&
                caught.code === "SSO_REQUIRED" &&
                typeof caught.details?.link_challenge === "string" &&
                typeof caught.details.sso_company_id === "number"
            ) {
                // Password and second factor are done; the company login is
                // linked now, at the company's identity provider.
                setInfo("Weiter zum Firmen-Login …");
                const started = await startSsoLink({
                    provider: "company",
                    company_id: caught.details.sso_company_id,
                    challenge: caught.details.link_challenge,
                });
                window.location.href = started.url;
                return;
            }

            if (caught instanceof ApiError) {
                setError(caught.message);
                setFieldErrors(caught.fields ?? {});
                setUnverified(caught.code === "EMAIL_UNVERIFIED");
                return;
            }

            if (caught instanceof Error) {
                setError(caught.message);
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const startCompanyLogin = async () => {
        setError(null);
        setFieldErrors({});

        if (!email.trim()) {
            setFieldErrors({ email: "Trag zuerst die E-Mail ein." });
            return;
        }

        try {
            const found = await discoverCompanySso(email);
            window.location.href = `/api/auth/sso/company/start?company_id=${found.company_id}`;
        } catch (caught: unknown) {
            setError(
                caught instanceof ApiError
                    ? caught.message
                    : "Der Firmen-Login konnte nicht gestartet werden.",
            );
        }
    };

    const resend = async () => {
        setError(null);
        try {
            const result = await resendVerification(email);
            setInfo(result.message);
        } catch (caught: unknown) {
            setError(
                caught instanceof Error
                    ? caught.message
                    : "Die Mail konnte nicht gesendet werden.",
            );
        }
    };

    if (user) {
        return <Navigate to={loginRedirectPath(location)} replace />;
    }

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
                        {challenge?.step === "totp_enroll"
                            ? "Diese Firma verlangt einen zweiten Faktor. Scanne den QR-Code mit der Authenticator-App und gib den Code ein."
                            : challenge
                              ? "Gib den Code aus der Authenticator-App oder einen Wiederherstellungscode ein."
                              : "Melde dich mit deinem Konto an."}
                    </p>
                </header>

                <form className={styles.form} onSubmit={handleSubmit}>
                    {challenge ? (
                        <div className={styles.field}>
                            {challenge.step === "totp_enroll" && qr && (
                                <img src={qr} alt="QR-Code für die Authenticator-App" />
                            )}
                            <label htmlFor="login-code">Code</label>
                            <Input
                                id="login-code"
                                size="lg"
                                fullWidth
                                autoComplete="one-time-code"
                                autoFocus
                                required
                                value={code}
                                onChange={(event) => setCode(event.target.value)}
                            />
                        </div>
                    ) : (
                        <>
                            <div className={styles.field}>
                                <label htmlFor="login-email">E-Mail</label>
                                <Input
                                    id="login-email"
                                    type="email"
                                    size="lg"
                                    fullWidth
                                    autoComplete="username"
                                    autoFocus
                                    required
                                    value={email}
                                    {...fieldAria("login-email", emailError)}
                                    onChange={(event) => setEmail(event.target.value)}
                                />
                                <FieldError
                                    fieldId="login-email"
                                    className={styles.error}
                                    announce={false}
                                >
                                    {emailError}
                                </FieldError>
                            </div>
                            <div className={styles.field}>
                                <label htmlFor="login-password">Passwort</label>
                                <Input
                                    id="login-password"
                                    type="password"
                                    size="lg"
                                    fullWidth
                                    autoComplete="current-password"
                                    required
                                    minLength={12}
                                    maxLength={128}
                                    value={password}
                                    {...fieldAria("login-password", passwordError)}
                                    onChange={(event) =>
                                        setPassword(event.target.value)
                                    }
                                />
                                <FieldError
                                    fieldId="login-password"
                                    className={styles.error}
                                    announce={false}
                                >
                                    {passwordError}
                                </FieldError>
                            </div>
                            <label className={styles.remember}>
                                <Checkbox
                                    checked={remember}
                                    onChange={(event) =>
                                        setRemember(event.target.checked)
                                    }
                                />
                                Angemeldet bleiben (7 Tage)
                            </label>
                        </>
                    )}
                    {formError && (
                        <p className={styles.banner} role="alert">
                            {formError}
                        </p>
                    )}
                    {info && <p className={styles.lead}>{info}</p>}
                    {unverified && (
                        <Button type="button" variant="ghost" onClick={resend}>
                            Bestätigungsmail erneut senden
                        </Button>
                    )}
                    <Button
                        type="submit"
                        fullWidth
                        size="lg"
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? "Wird angemeldet…" : "Anmelden"}
                    </Button>
                    <Button
                        type="button"
                        variant="secondary"
                        fullWidth
                        size="lg"
                        onClick={startCompanyLogin}
                    >
                        Mit Firmen-Login anmelden
                    </Button>
                </form>
                {!challenge && (
                    <>
                        <p className={styles.links}>
                            <Link to="/registrieren">Firma registrieren</Link>
                            <Link to="/passwort-vergessen">Passwort vergessen</Link>
                        </p>
                        {(providers.google || providers.microsoft) && (
                            <p className={styles.links}>
                                {providers.google && (
                                    <a href="/api/auth/sso/google/start">
                                        Mit Google
                                    </a>
                                )}
                                {providers.microsoft && (
                                    <a href="/api/auth/sso/microsoft/start">
                                        Mit Microsoft
                                    </a>
                                )}
                            </p>
                        )}
                    </>
                )}
                {import.meta.env.DEV && !challenge && (
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
