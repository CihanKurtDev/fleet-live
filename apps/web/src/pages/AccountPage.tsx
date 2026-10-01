import { useEffect, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import type { UserRole } from "@fleet-live/shared";
import {
    changePassword,
    confirmTotpSetup,
    createCompany,
    getSecurity,
    inviteMember,
    listMembers,
    removeMember,
    setMemberRole,
    setupTotp,
    updateSecurity,
    type CompanySecurity,
    type Member,
} from "../api/auth";
import { ApiError } from "../api/client";
import { Button } from "../components/ui/Button/Button";
import { Checkbox } from "../components/ui/Checkbox/Checkbox";
import { Input } from "../components/ui/Input/Input";
import { useAuth } from "../hooks/useAuth";
import styles from "./LoginPage.module.scss";

export const AccountPage = () => {
    const { user, setUser } = useAuth();
    const [members, setMembers] = useState<Member[]>([]);
    const [security, setSecurity] = useState<CompanySecurity | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);
    const [recovery, setRecovery] = useState<string[]>([]);
    const [otpauth, setOtpauth] = useState<string | null>(null);
    const [setupToken, setSetupToken] = useState<string | null>(null);
    const [qr, setQr] = useState<string | null>(null);
    const [currentPassword, setCurrentPassword] = useState("");
    const [nextPassword, setNextPassword] = useState("");
    const [code, setCode] = useState("");
    const [inviteEmail, setInviteEmail] = useState("");
    const [inviteRole, setInviteRole] = useState<UserRole>("viewer");
    const [companyName, setCompanyName] = useState("");
    const [issuer, setIssuer] = useState("");
    const [clientId, setClientId] = useState("");
    const [clientSecret, setClientSecret] = useState("");

    useEffect(() => {
        if (user?.role !== "dispatcher") {
            return;
        }

        listMembers()
            .then((result) => setMembers(result.data))
            .catch(() => setError("Mitglieder konnten nicht geladen werden."));
        getSecurity()
            .then((result) => {
                setSecurity(result);
                setIssuer(result.sso_issuer ?? "");
                setClientId(result.sso_client_id ?? "");
            })
            .catch(() => setError("Firmeneinstellungen konnten nicht geladen werden."));
    }, [user?.role, user?.company_id]);

    useEffect(() => {
        if (!otpauth) {
            return;
        }

        let cancelled = false;
        QRCode.toDataURL(otpauth, { margin: 1, width: 180 })
            .then((url) => {
                if (!cancelled) {
                    setQr(url);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setQr(null);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [otpauth]);

    if (!user) {
        return null;
    }

    const showError = (caught: unknown, fallback: string) => {
        setError(caught instanceof ApiError ? caught.message : fallback);
    };

    const change = async (event: FormEvent) => {
        event.preventDefault();
        setError(null);
        setInfo(null);

        try {
            await changePassword(currentPassword, nextPassword);
            setCurrentPassword("");
            setNextPassword("");
            setInfo("Passwort geändert. Andere Anmeldungen sind beendet.");
        } catch (caught: unknown) {
            showError(caught, "Passwort konnte nicht geändert werden.");
        }
    };

    const beginTotp = async () => {
        setError(null);
        try {
            const setup = await setupTotp();
            setOtpauth(setup.otpauth_url);
            setSetupToken(setup.setup_token ?? null);
            setInfo(`Geheimnis: ${setup.secret}`);
        } catch (caught: unknown) {
            showError(caught, "Zwei-Faktor konnte nicht gestartet werden.");
        }
    };

    const finishTotp = async (event: FormEvent) => {
        event.preventDefault();
        if (!setupToken) {
            return;
        }

        try {
            const result = await confirmTotpSetup({ code, setup_token: setupToken });
            setUser({ ...user, totp_enabled: true });
            setRecovery(result.recovery_codes ?? []);
            setOtpauth(null);
            setCode("");
            setInfo("Zwei-Faktor ist aktiv. Die Codes nur jetzt sichtbar.");
        } catch (caught: unknown) {
            showError(caught, "Code ist falsch.");
        }
    };

    const invite = async (event: FormEvent) => {
        event.preventDefault();
        setError(null);
        try {
            const result = await inviteMember(inviteEmail, inviteRole);
            setInfo(result.delivery === "log"
                ? "Einladung angelegt. Der Link steht im API-Log."
                : "Einladung verschickt.");
            setInviteEmail("");
            const listed = await listMembers();
            setMembers(listed.data);
        } catch (caught: unknown) {
            showError(caught, "Einladung ist fehlgeschlagen.");
        }
    };

    const saveSecurity = async (event: FormEvent) => {
        event.preventDefault();
        if (!security) {
            return;
        }

        try {
            const next = await updateSecurity({
                totp_required: security.totp_required,
                sso_required: security.sso_required,
                sso_issuer: issuer || null,
                sso_client_id: clientId || null,
                sso_client_secret: clientSecret || undefined,
            });
            setSecurity(next);
            setClientSecret("");
            setInfo("Firmeneinstellungen gespeichert.");
        } catch (caught: unknown) {
            showError(caught, "Einstellungen konnten nicht gespeichert werden.");
        }
    };

    const addCompany = async (event: FormEvent) => {
        event.preventDefault();
        try {
            const next = await createCompany(companyName);
            setUser(next);
            setCompanyName("");
            setInfo("Die neue Firma ist leer. Du bist dorthin gewechselt.");
        } catch (caught: unknown) {
            showError(caught, "Firma konnte nicht angelegt werden.");
        }
    };

    return (
        <section className={styles.accountPage}>
            <div className={styles.stack}>
                <header className={styles.accountHeader}>
                    <h1 className={styles.title}>Konto</h1>
                    <p className={styles.lead}>
                        {user.name} · {user.email} · {user.company_name}
                    </p>
                </header>
                {error && (
                    <p className={styles.banner} role="alert">
                        {error}
                    </p>
                )}
                {info && (
                    <p className={styles.notice} role="status">
                        {info}
                    </p>
                )}

                <section className={styles.section}>
                <form className={styles.form} onSubmit={change}>
                    <h2 className={styles.sectionTitle}>Passwort ändern</h2>
                    <div className={styles.field}>
                        <label htmlFor="current-password">Aktuelles Passwort</label>
                        <Input
                            id="current-password"
                            type="password"
                            size="lg"
                            fullWidth
                            required
                            autoComplete="current-password"
                            value={currentPassword}
                            onChange={(event) => setCurrentPassword(event.target.value)}
                        />
                    </div>
                    <div className={styles.field}>
                        <label htmlFor="next-password">Neues Passwort</label>
                        <Input
                            id="next-password"
                            type="password"
                            size="lg"
                            fullWidth
                            required
                            minLength={12}
                            maxLength={128}
                            autoComplete="new-password"
                            value={nextPassword}
                            onChange={(event) => setNextPassword(event.target.value)}
                        />
                    </div>
                    <Button type="submit">Passwort speichern</Button>
                </form>
                </section>

                <section className={styles.section}>
                <form className={styles.form} onSubmit={finishTotp}>
                    <h2 className={styles.sectionTitle}>Zwei-Faktor</h2>
                    <p className={styles.lead}>
                        {user.totp_enabled
                            ? "Authenticator-App ist eingerichtet."
                            : "Noch nicht eingerichtet."}
                    </p>
                    <Button type="button" variant="ghost" onClick={beginTotp}>
                        Einrichtung starten
                    </Button>
                    {otpauth && qr && (
                        <img src={qr} alt="QR-Code für die Authenticator-App" />
                    )}
                    {setupToken && (
                        <div className={styles.field}>
                            <label htmlFor="totp-code">Code aus der App</label>
                            <Input
                                id="totp-code"
                                size="lg"
                                fullWidth
                                required
                                autoComplete="one-time-code"
                                value={code}
                                onChange={(event) => setCode(event.target.value)}
                            />
                            <Button type="submit">Code bestätigen</Button>
                        </div>
                    )}
                    {recovery.length > 0 && (
                        <ul>
                            {recovery.map((item) => (
                                <li key={item}>{item}</li>
                            ))}
                        </ul>
                    )}
                </form>
                </section>

                <section className={styles.section}>
                <form className={styles.form} onSubmit={addCompany}>
                    <h2 className={styles.sectionTitle}>Weitere Firma</h2>
                    <div className={styles.field}>
                        <label htmlFor="new-company">Firmenname</label>
                        <Input
                            id="new-company"
                            size="lg"
                            fullWidth
                            required
                            value={companyName}
                            onChange={(event) => setCompanyName(event.target.value)}
                        />
                    </div>
                    <Button type="submit">Firma anlegen und wechseln</Button>
                </form>
                </section>

                {user.role === "dispatcher" && (
                    <>
                        <section className={styles.section}>
                        <form className={styles.form} onSubmit={invite}>
                            <h2 className={styles.sectionTitle}>Einladen</h2>
                            <div className={styles.field}>
                                <label htmlFor="invite-email">E-Mail</label>
                                <Input
                                    id="invite-email"
                                    type="email"
                                    size="lg"
                                    fullWidth
                                    required
                                    value={inviteEmail}
                                    onChange={(event) => setInviteEmail(event.target.value)}
                                />
                            </div>
                            <div className={styles.field}>
                                <label htmlFor="invite-role">Rolle</label>
                                <select
                                    id="invite-role"
                                    className={styles.roleSelect}
                                    value={inviteRole}
                                    onChange={(event) =>
                                        setInviteRole(event.target.value as UserRole)
                                    }
                                >
                                    <option value="dispatcher">Dispatcher</option>
                                    <option value="viewer">Nur lesen</option>
                                </select>
                            </div>
                            <Button type="submit">Einladen</Button>
                        </form>
                        <ul className={styles.members}>
                            {members.map((member) => (
                                <li key={member.user_id} className={styles.member}>
                                    <span className={styles.memberName}>
                                        {member.name} ({member.email})
                                    </span>
                                    <select
                                        className={styles.roleSelect}
                                        aria-label={`Rolle von ${member.name}`}
                                        value={member.role}
                                        onChange={async (event) => {
                                            const role = event.target.value as UserRole;
                                            try {
                                                const listed = await setMemberRole(
                                                    member.user_id,
                                                    role,
                                                );
                                                setMembers(listed.data);
                                            } catch (caught: unknown) {
                                                showError(caught, "Rolle nicht geändert.");
                                            }
                                        }}
                                    >
                                        <option value="dispatcher">Dispatcher</option>
                                        <option value="viewer">Nur lesen</option>
                                    </select>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={async () => {
                                            try {
                                                await removeMember(member.user_id);
                                                setMembers((current) =>
                                                    current.filter(
                                                        (item) =>
                                                            item.user_id !== member.user_id,
                                                    ),
                                                );
                                            } catch (caught: unknown) {
                                                showError(caught, "Mitglied bleibt.");
                                            }
                                        }}
                                    >
                                        Entfernen
                                    </Button>
                                </li>
                            ))}
                        </ul>
                        </section>
                        {security && (
                            <section className={styles.section}>
                            <form className={styles.form} onSubmit={saveSecurity}>
                                <h2 className={styles.sectionTitle}>Firmen-Login</h2>
                                <p className={styles.help}>
                                    Google und Microsoft auf der Anmeldeseite kommen
                                    aus den Server-Variablen. Hier hinterlegst du
                                    den eigenen IdP der Firma.
                                </p>
                                <label className={styles.remember}>
                                    <Checkbox
                                        checked={security.totp_required}
                                        onChange={(event) =>
                                            setSecurity({
                                                ...security,
                                                totp_required: event.target.checked,
                                            })
                                        }
                                    />
                                    Zwei-Faktor für alle verlangen
                                </label>
                                <label className={styles.remember}>
                                    <Checkbox
                                        checked={security.sso_required}
                                        onChange={(event) =>
                                            setSecurity({
                                                ...security,
                                                sso_required: event.target.checked,
                                            })
                                        }
                                    />
                                    Firmen-Login verlangen
                                </label>
                                <div className={styles.field}>
                                    <label htmlFor="sso-issuer">OIDC-Issuer</label>
                                    <Input
                                        id="sso-issuer"
                                        size="lg"
                                        fullWidth
                                        placeholder="https://login.microsoftonline.com/…/v2.0"
                                        value={issuer}
                                        onChange={(event) => setIssuer(event.target.value)}
                                    />
                                    <p className={styles.help}>
                                        Issuer-URL des IdP, unter der{" "}
                                        <code>/.well-known/openid-configuration</code>{" "}
                                        liegt. Entra:{" "}
                                        <code>…/&lt;Mandanten-ID&gt;/v2.0</code>
                                        . Redirect:{" "}
                                        <code>
                                            {`${window.location.origin}/api/auth/sso/company/callback`
                                                .split("/")
                                                .map((part, index) => (
                                                    <span key={`${part}-${index}`}>
                                                        {index > 0 ? (
                                                            <>
                                                                <wbr />/
                                                            </>
                                                        ) : null}
                                                        {part}
                                                    </span>
                                                ))}
                                        </code>
                                    </p>
                                </div>
                                <div className={styles.field}>
                                    <label htmlFor="sso-client-id">Client-ID</label>
                                    <Input
                                        id="sso-client-id"
                                        size="lg"
                                        fullWidth
                                        value={clientId}
                                        onChange={(event) => setClientId(event.target.value)}
                                    />
                                </div>
                                <div className={styles.field}>
                                    <label htmlFor="sso-client-secret">
                                        Client-Geheimnis
                                    </label>
                                    <Input
                                        id="sso-client-secret"
                                        type="password"
                                        size="lg"
                                        fullWidth
                                        autoComplete="new-password"
                                        value={clientSecret}
                                        onChange={(event) =>
                                            setClientSecret(event.target.value)
                                        }
                                    />
                                </div>
                                <Button type="submit">Einstellungen speichern</Button>
                            </form>
                            </section>
                        )}
                    </>
                )}
            </div>
        </section>
    );
};
