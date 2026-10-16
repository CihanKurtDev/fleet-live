import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router";
import QRCode from "qrcode";
import type { UserRole } from "@fleet-live/shared";
import {
    changePassword,
    confirmTotpSetup,
    disableTotp,
    createCompany,
    getSecurity,
    inviteMember,
    listMembers,
    removeMember,
    setMemberRole,
    setupTotp,
    switchCompany,
    updateSecurity,
    type CompanySecurity,
    type Member,
} from "../api/auth";
import { ApiError } from "../api/client";
import { Button } from "../components/ui/Button/Button";
import { Checkbox } from "../components/ui/Checkbox/Checkbox";
import { ConfirmDialog } from "../components/ui/Modal/ConfirmDialog";
import { Input } from "../components/ui/Input/Input";
import { Table } from "../components/ui/Table/Table";
import { useAuth } from "../hooks/useAuth";
import type { TableColumn } from "../types/table";
import authForm from "./LoginPage.module.scss";
import styles from "./AccountPage.module.scss";

/** Bereich im URL-Hash, z. B. `/konto#team`. */
type SectionId = "passwort" | "zwei-faktor" | "team" | "firmen-login" | "firmen";

const OWN_SECTIONS: SectionId[] = ["passwort", "zwei-faktor", "firmen"];
/** Firmenverwaltung nur für Dispatcher, wie die API. */
const DISPATCHER_SECTIONS: SectionId[] = [...OWN_SECTIONS, "team", "firmen-login"];

type Message = { section: SectionId; text: string };

const ROLE_LABEL: Record<UserRole, string> = {
    dispatcher: "Dispatcher",
    viewer: "Nur lesen",
};

const RoleOptions = () => (
    <>
        <option value="dispatcher">{ROLE_LABEL.dispatcher}</option>
        <option value="viewer">{ROLE_LABEL.viewer}</option>
    </>
);

export const AccountPage = () => {
    const { user, setUser } = useAuth();
    const { hash } = useLocation();
    const [members, setMembers] = useState<Member[]>([]);
    const [security, setSecurity] = useState<CompanySecurity | null>(null);
    const [error, setError] = useState<Message | null>(null);
    const [info, setInfo] = useState<Message | null>(null);
    const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
    const [isRemoving, setIsRemoving] = useState(false);
    const [recovery, setRecovery] = useState<string[]>([]);
    const [otpauth, setOtpauth] = useState<string | null>(null);
    const [setupToken, setSetupToken] = useState<string | null>(null);
    const [qr, setQr] = useState<string | null>(null);
    const [currentPassword, setCurrentPassword] = useState("");
    const [nextPassword, setNextPassword] = useState("");
    const [code, setCode] = useState("");
    const [disableCode, setDisableCode] = useState("");
    const [inviteEmail, setInviteEmail] = useState("");
    const [inviteRole, setInviteRole] = useState<UserRole>("viewer");
    const [companyName, setCompanyName] = useState("");
    const [issuer, setIssuer] = useState("");
    const [clientId, setClientId] = useState("");
    const [clientSecret, setClientSecret] = useState("");
    const [securityNote, setSecurityNote] = useState<string | null>(null);

    useEffect(() => {
        if (user?.role !== "dispatcher") {
            return;
        }

        listMembers()
            .then((result) => setMembers(result.data))
            .catch(() =>
                setError({
                    section: "team",
                    text: "Mitglieder konnten nicht geladen werden.",
                }),
            );
        getSecurity()
            .then((result) => {
                setSecurity(result);
                setIssuer(result.sso_issuer ?? "");
                setClientId(result.sso_client_id ?? "");
            })
            .catch(() =>
                setError({
                    section: "firmen-login",
                    text: "Firmeneinstellungen konnten nicht geladen werden.",
                }),
            );
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

    const isDispatcher = user.role === "dispatcher";
    const allowed = isDispatcher ? DISPATCHER_SECTIONS : OWN_SECTIONS;
    const requested = hash.replace(/^#/, "") as SectionId;
    const section: SectionId = allowed.includes(requested) ? requested : "passwort";

    const showError = (where: SectionId, caught: unknown, fallback: string) => {
        setError({
            section: where,
            text: caught instanceof ApiError ? caught.message : fallback,
        });
    };

    const clearMessages = () => {
        setError(null);
        setInfo(null);
    };

    const change = async (event: FormEvent) => {
        event.preventDefault();
        clearMessages();

        try {
            await changePassword(currentPassword, nextPassword);
            setCurrentPassword("");
            setNextPassword("");
            setInfo({
                section: "passwort",
                text: "Passwort geändert. Andere Anmeldungen sind beendet.",
            });
        } catch (caught: unknown) {
            showError("passwort", caught, "Passwort konnte nicht geändert werden.");
        }
    };

    const beginTotp = async () => {
        clearMessages();
        try {
            const setup = await setupTotp();
            setOtpauth(setup.otpauth_url);
            setSetupToken(setup.setup_token ?? null);
            setInfo({
                section: "zwei-faktor",
                text: `Schlüssel für die Authenticator-App: ${setup.secret}`,
            });
        } catch (caught: unknown) {
            showError("zwei-faktor", caught, "Zwei-Faktor konnte nicht gestartet werden.");
        }
    };

    const finishTotp = async (event: FormEvent) => {
        event.preventDefault();
        if (!setupToken) {
            return;
        }

        clearMessages();

        try {
            const result = await confirmTotpSetup({ code, setup_token: setupToken });
            setUser({ ...user, totp_enabled: true });
            setRecovery(result.recovery_codes ?? []);
            setOtpauth(null);
            setSetupToken(null);
            setQr(null);
            setCode("");
            setInfo({
                section: "zwei-faktor",
                text: "Zwei-Faktor ist aktiv. Die Codes nur jetzt sichtbar.",
            });
        } catch (caught: unknown) {
            showError("zwei-faktor", caught, "Code ist falsch.");
        }
    };

    const turnOffTotp = async (event: FormEvent) => {
        event.preventDefault();
        clearMessages();

        try {
            const next = await disableTotp(disableCode);
            setUser(next);
            setRecovery([]);
            setDisableCode("");
            setInfo({ section: "zwei-faktor", text: "Zwei-Faktor ist ausgeschaltet." });
        } catch (caught: unknown) {
            showError("zwei-faktor", caught, "Zwei-Faktor konnte nicht ausgeschaltet werden.");
        }
    };

    const invite = async (event: FormEvent) => {
        event.preventDefault();
        clearMessages();
        try {
            const result = await inviteMember(inviteEmail, inviteRole);
            setInfo({
                section: "team",
                text: result.delivery === "log"
                    ? "Einladung angelegt. Ein Mailversand ist nicht eingerichtet — der Link steht im Server-Log, nicht im Posteingang."
                    : "Einladung verschickt.",
            });
            setInviteEmail("");
            const listed = await listMembers();
            setMembers(listed.data);
        } catch (caught: unknown) {
            showError("team", caught, "Einladung ist fehlgeschlagen.");
        }
    };

    const changeRole = async (member: Member, role: UserRole) => {
        clearMessages();

        try {
            const listed = await setMemberRole(member.user_id, role);
            setMembers(listed.data);
            setInfo({
                section: "team",
                text: `${member.name} ist jetzt ${ROLE_LABEL[role]}.`,
            });
        } catch (caught: unknown) {
            showError("team", caught, "Rolle nicht geändert.");
        }
    };

    const remove = async (member: Member) => {
        clearMessages();
        setIsRemoving(true);

        try {
            await removeMember(member.user_id);
            setMembers((current) =>
                current.filter((item) => item.user_id !== member.user_id),
            );
            setInfo({ section: "team", text: `${member.name} entfernt.` });
        } catch (caught: unknown) {
            showError("team", caught, "Mitglied bleibt.");
        } finally {
            setIsRemoving(false);
            setRemoveTarget(null);
        }
    };

    const saveSecurity = async (event: FormEvent) => {
        event.preventDefault();
        if (!security) {
            return;
        }

        clearMessages();
        setSecurityNote(null);

        try {
            const next = await updateSecurity({
                totp_required: security.totp_required,
                sso_required: security.sso_required,
                sso_issuer: issuer || null,
                sso_client_id: clientId || null,
                sso_client_secret: clientSecret || undefined,
            });
            setSecurity(next);
            setIssuer(next.sso_issuer ?? "");
            setClientId(next.sso_client_id ?? "");
            setClientSecret("");
            setSecurityNote(
                next.sso_secret_set
                    ? "Gespeichert. Das Client-Geheimnis bleibt hinterlegt und wird nicht wieder angezeigt."
                    : "Gespeichert.",
            );
        } catch (caught: unknown) {
            showError("firmen-login", caught, "Einstellungen konnten nicht gespeichert werden.");
        }
    };

    const addCompany = async (event: FormEvent) => {
        event.preventDefault();
        try {
            const next = await createCompany(companyName);
            setUser(next);
            setCompanyName("");
            setInfo({
                section: "firmen",
                text: "Die neue Firma ist leer. Du bist dorthin gewechselt.",
            });
        } catch (caught: unknown) {
            showError("firmen", caught, "Firma konnte nicht angelegt werden.");
        }
    };

    const enterCompany = async (companyId: number) => {
        clearMessages();
        try {
            const next = await switchCompany(companyId);
            setUser(next);
            setInfo({
                section: "firmen",
                text: `Du arbeitest jetzt in ${next.company_name}.`,
            });
        } catch (caught: unknown) {
            showError("firmen", caught, "Firma konnte nicht gewechselt werden.");
        }
    };

    const memberColumns: TableColumn<Member>[] = [
        {
            key: "name",
            displayText: "Name",
            render: (name, { row }) => (
                <span className={styles.strong}>
                    {name}
                    {row.user_id === user.id && (
                        <span className={styles.muted}> (du)</span>
                    )}
                </span>
            ),
        },
        {
            key: "email",
            displayText: "E-Mail",
            render: (email) => <span className={styles.email}>{email}</span>,
        },
        {
            key: "role",
            displayText: "Rolle",
            width: "170px",
            render: (role, { row }) => (
                <select
                    className={`${styles.roleSelect} ${styles.roleSelectSm}`}
                    aria-label={`Rolle von ${row.name}`}
                    value={role}
                    onChange={(event) =>
                        changeRole(row, event.target.value as UserRole)
                    }
                >
                    <RoleOptions />
                </select>
            ),
        },
        {
            key: "user_id",
            displayText: "Entfernen",
            headerText: "",
            width: "120px",
            render: (_, { row }) => (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setRemoveTarget(row)}
                >
                    Entfernen
                </Button>
            ),
        },
    ];

    const navLink = (
        id: SectionId,
        label: string,
        state?: { text: string; off: boolean },
    ) => (
        <Link
            to={{ hash: `#${id}` }}
            replace
            className={styles.navLink}
            aria-current={section === id ? "page" : undefined}
        >
            {label}
            {state && (
                <>
                    {" "}
                    <span className={state.off ? styles.stateOff : styles.stateOn}>
                        · {state.text}
                    </span>
                </>
            )}
        </Link>
    );

    const sectionError = error?.section === section ? error.text : null;
    const sectionInfo = info?.section === section ? info.text : null;
    // Shown right under the form that caused them, so the answer is next to
    // the action and nothing above it moves.
    const messages = (
        <>
            {sectionError && (
                <p className={authForm.banner} role="alert">
                    {sectionError}
                </p>
            )}
            {sectionInfo && (
                <p className={authForm.notice} role="status">
                    {sectionInfo}
                </p>
            )}
        </>
    );

    return (
        <section className={styles.page}>
            <header className={styles.head}>
                <h1 className={styles.title}>Konto</h1>
                <p className={styles.lead}>
                    {user.name} · {user.email} ·{" "}
                    {isDispatcher ? "Dispatcher" : "Lesezugriff"} bei{" "}
                    {user.company_name}
                </p>
            </header>

            <div className={styles.body}>
                <nav aria-label="Kontobereiche" className={styles.nav}>
                    <div
                        className={styles.group}
                        role="group"
                        aria-labelledby="konto-nav-ich"
                    >
                        <span id="konto-nav-ich" className={styles.groupLabel}>
                            Ich
                        </span>
                        {navLink("passwort", "Passwort")}
                        {navLink("zwei-faktor", "Zwei-Faktor", {
                            text: user.totp_enabled ? "an" : "aus",
                            off: !user.totp_enabled,
                        })}
                    </div>
                    {isDispatcher && (
                        <div
                            className={styles.group}
                            role="group"
                            aria-labelledby="konto-nav-firma"
                        >
                            <span id="konto-nav-firma" className={styles.groupLabel}>
                                {user.company_name}
                            </span>
                            {navLink("team", "Team und Einladungen")}
                            {navLink("firmen-login", "Firmen-Login")}
                        </div>
                    )}
                    <div
                        className={styles.group}
                        role="group"
                        aria-labelledby="konto-nav-firmen"
                    >
                        <span id="konto-nav-firmen" className={styles.groupLabel}>
                            Firmen
                        </span>
                        {navLink("firmen", "Firma wechseln oder anlegen")}
                    </div>
                </nav>

                <div className={styles.content}>
                    {section === "passwort" && (
                        <>
                        <section className={styles.panel}>
                            <form
                                className={`${styles.form} ${styles.narrow}`}
                                onSubmit={change}
                            >
                                <h2 className={styles.panelTitle}>Passwort ändern</h2>
                                <div className={authForm.field}>
                                    <label htmlFor="current-password">
                                        Aktuelles Passwort
                                    </label>
                                    <Input
                                        id="current-password"
                                        type="password"
                                        size="md"
                                        fullWidth
                                        required
                                        autoComplete="current-password"
                                        value={currentPassword}
                                        onChange={(event) =>
                                            setCurrentPassword(event.target.value)
                                        }
                                    />
                                </div>
                                <div className={authForm.field}>
                                    <label htmlFor="next-password">Neues Passwort</label>
                                    <Input
                                        id="next-password"
                                        type="password"
                                        size="md"
                                        fullWidth
                                        required
                                        minLength={12}
                                        maxLength={128}
                                        autoComplete="new-password"
                                        value={nextPassword}
                                        onChange={(event) =>
                                            setNextPassword(event.target.value)
                                        }
                                    />
                                </div>
                                <Button type="submit">Passwort speichern</Button>
                            </form>
                        </section>
                        {messages}
                        </>
                    )}

                    {section === "zwei-faktor" && (
                        <>
                        <section className={styles.panel}>
                            <form className={styles.form} onSubmit={finishTotp}>
                                <h2 className={styles.panelTitle}>Zwei-Faktor</h2>
                                <p className={styles.help}>
                                    {user.totp_enabled
                                        ? "Authenticator-App ist eingerichtet."
                                        : "Noch nicht eingerichtet."}
                                </p>
                                <Button type="button" variant="ghost" onClick={beginTotp}>
                                    {user.totp_enabled ? "Neu einrichten" : "Einrichtung starten"}
                                </Button>
                                {((otpauth && qr) || setupToken) && (
                                    <div className={styles.totpSetup}>
                                        {otpauth && qr && (
                                            <img
                                                className={styles.qr}
                                                src={qr}
                                                alt="QR-Code für die Authenticator-App"
                                            />
                                        )}
                                        {setupToken && (
                                            <div
                                                className={`${authForm.field} ${styles.narrow}`}
                                            >
                                                <label htmlFor="totp-code">
                                                    Code aus der App
                                                </label>
                                                <Input
                                                    id="totp-code"
                                                    size="md"
                                                    fullWidth
                                                    required
                                                    autoComplete="one-time-code"
                                                    value={code}
                                                    onChange={(event) =>
                                                        setCode(event.target.value)
                                                    }
                                                />
                                                <Button type="submit">Code bestätigen</Button>
                                            </div>
                                        )}
                                    </div>
                                )}
                                {recovery.length > 0 && (
                                    <ul className={styles.codes}>
                                        {recovery.map((item) => (
                                            <li key={item}>{item}</li>
                                        ))}
                                    </ul>
                                )}
                            </form>
                            {user.totp_enabled && !setupToken && (
                                <form
                                    className={`${styles.form} ${styles.narrow}`}
                                    onSubmit={turnOffTotp}
                                >
                                    <h2 className={styles.panelTitle}>Ausschalten</h2>
                                    <p className={styles.help}>
                                        Zum Ausschalten den aktuellen Code aus der App eingeben.
                                    </p>
                                    <div className={authForm.field}>
                                        <label htmlFor="totp-disable-code">Code aus der App</label>
                                        <Input
                                            id="totp-disable-code"
                                            size="md"
                                            fullWidth
                                            required
                                            autoComplete="one-time-code"
                                            value={disableCode}
                                            onChange={(event) => setDisableCode(event.target.value)}
                                        />
                                    </div>
                                    <Button type="submit" variant="dangerOutline">
                                        Zwei-Faktor ausschalten
                                    </Button>
                                </form>
                            )}
                        </section>
                        {messages}
                        </>
                    )}

                    {section === "team" && (
                        <>
                            <section className={styles.panel}>
                                <form className={styles.form} onSubmit={invite}>
                                    <h2 className={styles.panelTitle}>Jemanden einladen</h2>
                                    <div className={styles.inviteRow}>
                                        <div className={authForm.field}>
                                            <label htmlFor="invite-email">E-Mail</label>
                                            <Input
                                                id="invite-email"
                                                type="email"
                                                size="md"
                                                fullWidth
                                                required
                                                placeholder="name@firma.de"
                                                value={inviteEmail}
                                                onChange={(event) =>
                                                    setInviteEmail(event.target.value)
                                                }
                                            />
                                        </div>
                                        <div className={authForm.field}>
                                            <label htmlFor="invite-role">Rolle</label>
                                            <select
                                                id="invite-role"
                                                className={styles.roleSelect}
                                                value={inviteRole}
                                                onChange={(event) =>
                                                    setInviteRole(
                                                        event.target.value as UserRole,
                                                    )
                                                }
                                            >
                                                <RoleOptions />
                                            </select>
                                        </div>
                                        <Button type="submit" size="md">
                                            Einladen
                                        </Button>
                                    </div>
                                </form>
                            </section>
                            {messages}
                            <section className={`${styles.panel} ${styles.teamPanel}`}>
                                <div className={styles.panelHead}>
                                    <h2 className={styles.panelTitle}>
                                        Team{" "}
                                        <span className={styles.count}>{members.length}</span>
                                    </h2>
                                    <span className={styles.muted}>
                                        Mindestens ein Dispatcher bleibt
                                    </span>
                                </div>
                                <div className={styles.tableScroll}>
                                    <Table
                                        columns={memberColumns}
                                        rows={members}
                                        getRowKey={(member) => member.user_id}
                                        caption="Mitglieder der Firma"
                                        className={styles.members}
                                        emptyContent="Keine Mitglieder"
                                    />
                                </div>
                            </section>
                        </>
                    )}

                    {section === "firmen-login" && (
                        <>
                        <section className={styles.panel}>
                            <h2 className={styles.panelTitle}>Firmen-Login</h2>
                            {security ? (
                                <form className={styles.form} onSubmit={saveSecurity}>
                                    <p className={styles.help}>
                                        Google und Microsoft auf der Anmeldeseite kommen
                                        aus den Server-Variablen. Hier hinterlegst du
                                        den eigenen IdP der Firma.
                                    </p>
                                    <div className={styles.checks}>
                                        <label className={authForm.remember}>
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
                                        <label className={authForm.remember}>
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
                                    </div>
                                    <div className={authForm.field}>
                                        <label htmlFor="sso-issuer">OIDC-Issuer</label>
                                        <Input
                                            id="sso-issuer"
                                            size="md"
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
                                    <div className={styles.pair}>
                                        <div className={authForm.field}>
                                            <label htmlFor="sso-client-id">Client-ID</label>
                                            <Input
                                                id="sso-client-id"
                                                size="md"
                                                fullWidth
                                                value={clientId}
                                                onChange={(event) =>
                                                    setClientId(event.target.value)
                                                }
                                            />
                                        </div>
                                        <div className={authForm.field}>
                                            <label htmlFor="sso-client-secret">
                                                Client-Geheimnis
                                            </label>
                                            <Input
                                                id="sso-client-secret"
                                                type="password"
                                                size="md"
                                                fullWidth
                                                autoComplete="new-password"
                                                value={clientSecret}
                                                onChange={(event) =>
                                                    setClientSecret(event.target.value)
                                                }
                                            />
                                        </div>
                                    </div>
                                    {security.sso_secret_set && !clientSecret && (
                                        <p className={styles.help}>
                                            Ein Client-Geheimnis ist gespeichert.
                                            Nur ausfüllen, wenn du es ersetzen willst.
                                        </p>
                                    )}
                                    <Button type="submit">Einstellungen speichern</Button>
                                    {securityNote && (
                                        <p className={authForm.notice} role="status">
                                            {securityNote}
                                        </p>
                                    )}
                                </form>
                            ) : (
                                !sectionError && <p className={styles.help}>Laden…</p>
                            )}
                        </section>
                        {messages}
                        </>
                    )}

                    {section === "firmen" && (
                        <>
                            <section className={styles.panel}>
                                <h2 className={styles.panelTitle}>Deine Firmen</h2>
                                <ul className={styles.companies}>
                                    {user.memberships.map((membership) => (
                                        <li
                                            key={membership.company_id}
                                            className={styles.company}
                                        >
                                            <span className={styles.strong}>
                                                {membership.company_name}
                                            </span>
                                            <span className={styles.muted}>
                                                {ROLE_LABEL[membership.role]}
                                            </span>
                                            {membership.company_id === user.company_id ? (
                                                <span className={styles.active}>Aktiv</span>
                                            ) : (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    aria-label={`Zu ${membership.company_name} wechseln`}
                                                    onClick={() =>
                                                        enterCompany(membership.company_id)
                                                    }
                                                >
                                                    Wechseln
                                                </Button>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </section>
                            <section className={styles.panel}>
                                <form
                                    className={`${styles.form} ${styles.narrow}`}
                                    onSubmit={addCompany}
                                >
                                    <h2 className={styles.panelTitle}>Weitere Firma</h2>
                                    <div className={authForm.field}>
                                        <label htmlFor="new-company">Firmenname</label>
                                        <Input
                                            id="new-company"
                                            size="md"
                                            fullWidth
                                            required
                                            value={companyName}
                                            onChange={(event) =>
                                                setCompanyName(event.target.value)
                                            }
                                        />
                                    </div>
                                    <Button type="submit">Firma anlegen und wechseln</Button>
                                </form>
                            </section>
                            {messages}
                        </>
                    )}

                </div>
            </div>

            <ConfirmDialog
                open={removeTarget !== null}
                onClose={() => setRemoveTarget(null)}
                title="Mitglied entfernen?"
                confirmLabel="Entfernen"
                busyLabel="Wird entfernt…"
                isBusy={isRemoving}
                onConfirm={() => (removeTarget ? remove(removeTarget) : undefined)}
            >
                {removeTarget
                    ? `${removeTarget.name} verliert den Zugang zu dieser Firma. Das Konto selbst bleibt bestehen.`
                    : null}
            </ConfirmDialog>
        </section>
    );
};
