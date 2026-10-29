# Sicherheits-Härtung: Befunde und Stand

Stand: 2026-10-23. Jeder Punkt hat einen Status:

| Status | Bedeutung |
| --- | --- |
| **ERLEDIGT** | War vor dieser Härtung schon im Code und ist geprüft (Test oder Code-Stelle). |
| **IMPLEMENTIERT** | In dieser Härtung behoben, mit Regressionstest. Ein Test mit „rot geprüft“ schlägt ohne den Fix fehl. |
| **OFFEN** | Bekannt, nicht behoben; mit Grund und nächstem Schritt. |
| **NICHT REPRODUZIERBAR** | Geprüft, der Angriff gelingt nicht; abgesichert durch Tests. |
| **NICHT ANWENDBAR** | Trifft auf diese Architektur nicht zu. |

Tests liegen unter `apps/api/src/test/` (node:test + SuperTest, In-Memory-SQLite) und `apps/web/src/test/` (Vitest).

---

## A. Code-Fixes

### A1. Identitäten, Anmeldung, Mandanten (P0)

| # | Befund | Status | Ursache und Änderung | Tests |
| --- | --- | --- | --- | --- |
| A1.1 | **Kontoübernahme über SSO-E-Mail.** Ein Login (auch der OIDC-IdP einer anderen Firma) konnte ein bestehendes Konto übernehmen, wenn er dessen E-Mail als bestätigt meldete. | IMPLEMENTIERT | `finishSso` verknüpfte bei unbekanntem Subject per `UserModel.findByEmail` automatisch. Jetzt: `sso_identities` ist (Provider, Issuer, Subject) mit `UNIQUE` und `CHECK`; Login findet nur verknüpfte Identitäten. Verknüpfen nur ausdrücklich: angemeldet über `POST /api/auth/sso/link`, oder einmalig mit einem `sso_link`-Schritt nach Passwort und zweitem Faktor. Der Provider muss die bestätigte E-Mail des Kontos melden (Konsistenzprüfung, keine Zuordnung). Eine schon vergebene Identität bleibt beim Inhaber (`taken`). | `ssoLinking.test.ts`: unbekannte E-Mail, lokales Konto mit gleicher E-Mail, IdP von Firma A und Nutzer von B, Person mit mehreren Firmen und Rollen, Übernahme einer verknüpften Identität, parallele Verknüpfungen, falscher Issuer, leeres Subject, legitime Verknüpfung, fehlgeschlagene Verknüpfung ohne Sitzung, Replay und verbrauchter State |
| A1.2 | **Bestehende Verknüpfungen** sind unter A1.1 entstanden und damit nicht vertrauenswürdig. | IMPLEMENTIERT | Migration v23 (`ensureAuthHardening`) verschiebt alle alten Zeilen unverändert nach `sso_identities_legacy`; sie melden niemanden mehr an. Die Inhaber verknüpfen neu. Kein automatisches Zusammenführen. Die Migration ist idempotent und läuft in einer Transaktion je Tabellenumbau. | `authMigrate.test.ts`; zusätzlich auf einer Kopie der Dev-DB ausgeführt (Integritäts- und Fremdschlüsselprüfung ok) |
| A1.3 | **SSO-Login übersprang Zwei-Faktor und Firmen-SSO-Pflicht.** Google/Microsoft/Firmen-OIDC öffneten sofort eine Sitzung. | IMPLEMENTIERT | Eine Entscheidung für alle Wege (`decideLogin`, `continueLogin`): Passwort, Google, Microsoft, Firmen-OIDC, zweiter Faktor, Einladung. Nach dem IdP folgt bei Bedarf der TOTP-Schritt (Übergabe im URL-Fragment, das weder Server noch Referer sehen). Keine Ausnahme für IdP-MFA. Google/Microsoft öffnen keine Sitzung in einer Firma, die ihren eigenen Login verlangt. | `loginPolicy.test.ts` |
| A1.4 | **Offene Sitzungen blieben gültig**, wenn eine Firma Zwei-Faktor oder den Firmen-Login verpflichtend machte. | IMPLEMENTIERT | `sessions.mfa` und `sessions.sso_company_id`; `SessionModel.find` prüft jede Anfrage mit `policyGap` und löscht eine Sitzung, die die Regeln nicht mehr erfüllt. Alte Sitzungen gelten als ohne beides. | `loginPolicy.test.ts` („an open session“) |
| A1.5 | **Firmenwechsel** prüfte nur, ob das Konto TOTP eingerichtet hat, nicht ob die Sitzung ihn bestanden hat. | IMPLEMENTIERT | `switchCompany` nutzt dieselbe Prüfung (`TOTP_REQUIRED`, `SSO_REQUIRED`). | `loginPolicy.test.ts` |
| A1.6 | **Firmen-Login einer Firma öffnete Zugang zu allen Firmen** der Person (Firmenwechsel). Ein Firmen-Admin, der seinen IdP kontrolliert, hätte so eine verknüpfte Person in deren andere Firmen bringen können. | IMPLEMENTIERT | Eine Sitzung aus dem Firmen-Login ist an diese Firma gebunden (`REAUTH_REQUIRED` beim Wechsel und beim Anlegen einer Firma). | `ssoLinking.test.ts` (mehrere Firmen), `loginPolicy.test.ts` |
| A1.7 | **Einladung annehmen** öffnete eine Sitzung ohne den zweiten Faktor oder Firmen-Login, den die Firma verlangt. | IMPLEMENTIERT | Annahme setzt Name und Passwort; ohne erfüllte Regeln antwortet sie `{ next: "login" }`, die Seite leitet zum Login. | `loginPolicy.test.ts`, `authPages.test.tsx` |
| A1.8 | **Selbst-Aussperrung:** Zwei-Faktor- oder SSO-Pflicht ließ sich aus einer Sitzung einschalten, die sie nicht erfüllt; ein IdP-Wechsel unter aktiver Pflicht sperrte alle aus. | IMPLEMENTIERT | Zwei-Faktor-Pflicht nur aus einer Sitzung mit Faktor; SSO-Pflicht nur aus einer Firmen-Login-Sitzung oder mit eigener Verknüpfung zum aktuellen Issuer (`SSO_LINK_REQUIRED`, die Kontoseite startet dann die Verknüpfung). Issuer, Client-ID oder Secret ändern nur bei ausgeschalteter Pflicht (`409`). | `loginPolicy.test.ts`, `accountPage.test.tsx` |
| A1.9 | **SSO-Callback-Replay und Wettlauf:** Der State wurde erst nach dem asynchronen IdP-Aufruf verbraucht; zwei gleichzeitige Callbacks ergaben zwei Sitzungen. | IMPLEMENTIERT | `AuthTokenModel.claim` verbraucht atomar (`UPDATE … WHERE used_at IS NULL`) vor dem IdP-Aufruf; der State-Cookie muss passen. | `ssoLinking.test.ts` (rot geprüft) |
| A1.10 | **Issuer und Subject** des Tokens wurden nicht gegen den Flow geprüft; ein leeres `sub` hätte verknüpft werden können. | IMPLEMENTIERT | `issuerMatches` (Entra-Multi-Tenant über die Tenant-ID im Token), leeres Subject abgewiesen; zusätzlich `CHECK` in der Tabelle. Signatur, `aud`, `nonce`, PKCE und Ablauf prüft weiterhin `openid-client`. | `ssoLinking.test.ts`, `oidcSsrf.test.ts` |
| A1.11 | Einmal-Tokens (Bestätigung, Reset, Einladung, Login-Schritt) wurden erst gelesen und dann verbraucht. | IMPLEMENTIERT | Im einzelnen Prozess war das nicht ausnutzbar (synchrone Verarbeitung); jetzt atomar per `claim`, auch über Prozesse hinweg. Ein erfolgreicher Reset löscht die übrigen Reset-Links. | bestehende Auth-Tests, `ssoLinking.test.ts` |
| A1.12 | Mandantentrennung der Datenrouten (Fahrzeuge, Fahrer, Fahrten, Telemetrie, Warnungen, Fristen, Import/Export, Schicht, Depots). | NICHT REPRODUZIERBAR | Firma kommt überall aus der Sitzung; fremde IDs sind `404`. | bestehend: `vehicles.test.ts` („tenant isolation“, „roles“), `drivers.test.ts`, `sites.test.ts`, `alerts.test.ts`, `export.test.ts`; neu: `tenantAuth.test.ts` |
| A1.13 | Rechteausweitung auf der Auth-Ebene (Viewer hebt eigene Rolle, Mitglieder fremder Firmen ändern, `company_id` im Body, letzter Dispatcher, fremde SSO-Konfiguration). | NICHT REPRODUZIERBAR | Server prüft Rolle und Mitgliedschaft; der Body bestimmt keine Firma. | `tenantAuth.test.ts` |

### A2. Live-Strom, OIDC, Geheimnisse (P1)

| # | Befund | Status | Ursache und Änderung | Tests |
| --- | --- | --- | --- | --- |
| A2.1 | **SSE-Verbindungen überlebten ihre Sitzung** (Logout, Logout-all, Passwortwechsel/-reset, entfernte Mitgliedschaft, Rollen- und Firmenwechsel, Regeländerung, Ablauf). | IMPLEMENTIERT | Der Hub kennt Person und Token-Hash jeder Verbindung (`endStreams`); der Heartbeat (15 s) prüft die Sitzung ohne sie zu verlängern. | `streamSession.test.ts` (rot geprüft, 9 von 9) |
| A2.2 | Eine andere Person derselben Firma konnte den Fokus einer fremden Verbindung setzen. | IMPLEMENTIERT | `setConnectionFocus` verlangt dieselbe Person. | `streamSession.test.ts` |
| A2.3 | Unbegrenzt viele offene Live-Verbindungen je Person. | IMPLEMENTIERT | Höchstens 20 je Person (`429 STREAM_LIMIT`). | `streamSession.test.ts` |
| A2.4 | **SSRF über den OIDC-Issuer** einer Firma (Discovery, JWKS, Token-Endpunkt auf interne Adressen). | IMPLEMENTIERT | `guardedFetch` für alle Anfragen von `openid-client`: nur HTTPS, Adresse nach DNS geprüft (Loopback, privat, Link-Local, Metadaten, gemappte IPv6), keine Weiterleitungen, 10 s, 1 MB. `assertSafeIssuer` beim Speichern. Interne IdPs nur über `OIDC_PRIVATE_HOSTS` (Hostnamen, keine Platzhalter; der Server loggt die Liste beim Start als Warnung). | `oidcSsrf.test.ts` |
| A2.5 | Wiederherstellungscode schaltete Zwei-Faktor ab und löschte alle Codes; das Konto blieb danach ohne zweiten Faktor. | IMPLEMENTIERT | Ein Code gilt einmal, der Faktor bleibt; ein neuer Authenticator wird im Konto eingerichtet. | `totpSecurity.test.ts` (rot geprüft) |
| A2.6 | TOTP-Geheimnis lag während der Einrichtung im Klartext in `auth_tokens.payload`. | IMPLEMENTIERT | Mit `seal` verschlüsselt wie im Konto. | `totpSecurity.test.ts` (rot geprüft) |
| A2.7 | Passwort-Hashing, Timing bei unbekannter E-Mail, Rehash bei niedrigerer Kosten. | ERLEDIGT | scrypt N=65 536, `spendPasswordTime`, `needsRehash`. | `password.test.ts` |
| A2.8 | TOTP-Replay, Fehlversuche je Schritt und je Konto. | ERLEDIGT | `totp_last_step`, 5 je Schritt, 10 je Konto in 15 Min. | `totpSecurity.test.ts` |
| A2.9 | Session-Fixation, gehashte Session-Tokens, Leerlauf-Ende. | ERLEDIGT | Login ersetzt die alte Sitzung des Browsers; DB hält nur SHA-256. | `sessionStore.test.ts` |
| A2.10 | CSRF. | ERLEDIGT | SameSite=Lax, JSON-Bodies, in Produktion Origin-Prüfung bei Schreibzugriffen. | `hardening.test.ts` (Produktionsschutz) |
| A2.11 | OIDC state, PKCE, nonce, audience. | ERLEDIGT | `openid-client` prüft sie; der State ist zusätzlich an ein Cookie gebunden. | `ssoLinking.test.ts` |
| A2.12 | Cookie und Authorization im Request-Log. | ERLEDIGT | `logger.ts` redigiert sie. | Code-Stelle |

### A3. Limits, Import/Export, allgemeines Review (P1–P2)

| # | Befund | Status | Ursache und Änderung | Tests |
| --- | --- | --- | --- | --- |
| A3.1 | **Zip-Bombe im Excel-Import:** Größen wurden erst nach dem Entpacken geprüft (eine Datei unter 1 MB belegte 397 MB). | IMPLEMENTIERT | Prüfung der deklarierten Größen und Eintragszahl im `filter` von `fflate` vor dem Entpacken; `fflate` entpackt höchstens die deklarierte Größe. | `importLimits.test.ts` (rot geprüft) |
| A3.2 | CSV-Formel-Injection im Export: führender Leerraum, Tab, Zeilenumbruch und Zeichen in voller Breite wurden nicht abgefangen. | IMPLEMENTIERT | `csvCell` setzt `'` auch dort. | `export.test.ts` (rot geprüft) |
| A3.3 | **Stored XSS auf den Karten:** Leaflet schreibt Tooltip-Texte als HTML; Kennzeichen, Fahrer- und Depotnamen (auch aus Importen) liefen ungefiltert hinein. | IMPLEMENTIERT | `components/vehicles/mapLabels.ts` escaped jede Beschriftung. | `mapLabels.test.ts` |
| A3.4 | Keine IP-Limits für TOTP, Token-Links (Reset, Bestätigung, Einladung) und SSO-Starts. | IMPLEMENTIERT | `loginIpRateLimit` für TOTP, `tokenIpRateLimit` (20 ungültige Links je 15 Min), `ssoStartRateLimit` (30 Starts je 15 Min). | `hardening.test.ts` mit Kindprozess außerhalb des Testmodus (rot geprüft) |
| A3.5 | Proxy-Vertrauen ungeregelt. | IMPLEMENTIERT | `TRUST_PROXY_HOPS` (Standard 0: `X-Forwarded-For` wird ignoriert, die Socket-Adresse zählt). | `hardening.test.ts` |
| A3.6 | `auth_tokens` wuchs ohne Ende; SSO-Starts legen ohne Anmeldung Zeilen an. | IMPLEMENTIERT | Abgelaufene Tokens werden eine Woche nach Ablauf mit den Sitzungen gelöscht; SSO-Starts sind begrenzt (A3.4). | `sessionStore.test.ts` (rot geprüft) |
| A3.7 | `X-Request-Id` wurde ungeprüft in Header und Log übernommen. | IMPLEMENTIERT | Nur `[A-Za-z0-9._-]{1,128}`, sonst neue UUID. | `hardening.test.ts` |
| A3.8 | Verwundbare Abhängigkeiten (`vite` 8.2.2 hoch, `vitest` 5.0.2 mittel). | IMPLEMENTIERT | `npm audit fix` innerhalb der Semver-Bereiche (vite 8.3.5, vitest 5.0.5); Build und Web-Tests grün. | `npm audit`, `npm run build -w web`, `npm run test:web` |
| A3.9 | SQL-Injection über Sortierung und Filter. | NICHT REPRODUZIERBAR | Sortspalten aus festen Tabellen, Werte gebunden, Parameter per Zod-Enum. | Code-Stellen `vehicle.model.ts`, `alert.model.ts`, `driver.model.ts` |
| A3.10 | Offene Weiterleitungen. | NICHT REPRODUZIERBAR | Server leitet nur auf `WEB_ORIGIN` mit festen Pfaden; die Web-App nur auf interne `state.from`. | Code-Stellen |
| A3.11 | Tokens im Browser-Speicher. | NICHT REPRODUZIERBAR | Sitzung nur als HttpOnly-Cookie; `localStorage` hält nur UI-Merker. | Code-Stellen |
| A3.12 | Unbegrenzte Abfragen. | NICHT REPRODUZIERBAR | Listen höchstens 100, Fokus höchstens 3 000 IDs, Import höchstens 150 000 Zeilen und 32 MB. Exporte sind absichtlich vollständig (nur Dispatcher). | bestehende Tests |
| A3.13 | Stacktraces in Fehlerantworten. | ERLEDIGT | Nur außerhalb der Produktion. | `errorHandler.ts` |
| A3.14 | Veralteter Anmeldezustand im Frontend. | ERLEDIGT | Eine `401` mitten in der Sitzung führt zu `/login`; ein abgebrochener Live-Strom prüft `/api/auth/me`. | `client.auth.test.ts` |
| A3.15 | WebSocket-spezifische Angriffe. | NICHT ANWENDBAR | Live-Daten laufen über SSE. | – |

### A4. Offene Punkte

| # | Befund | Status | Grund und nächster Schritt |
| --- | --- | --- | --- |
| A4.1 | Registrierung verrät, ob eine E-Mail schon ein Konto hat (`409`). | OFFEN | Produktentscheidung: gleiche Antwort für beide Fälle und Hinweis-Mail an das bestehende Konto ändert die Registrierungsseite. |
| A4.2 | `POST /api/auth/sso/company/discover` nennt zu einer bestätigten E-Mail die Firma mit Firmen-Login. | OFFEN | Durch `authIpRateLimit` gebremst. Besser: Zuordnung über eine pro Firma bestätigte E-Mail-Domain. |
| A4.3 | Einladung eines bestehenden Kontos legt die Mitgliedschaft sofort an, ohne Zustimmung. Der Passwort-Login wählt die erste Firma ohne Firmen-Login alphabetisch, eine fremde Firma kann also die Startfirma werden. | IMPLEMENTIERT | Jede Einladung steht in `company_invites` und wird erst mit der Annahme zur Mitgliedschaft (Link für ein neues Konto, sonst Konto → Firmen). Bis dahin kann der Login dort nicht landen. Dispatcher sehen offene Einladungen im Team und ziehen sie zurück; der Mail-Link gilt dann nicht mehr. Alte, nie angenommene Einladungen werden beim Start zu offenen Einladungen. Test: `invitations.test.ts`. |
| A4.4 | Kein Audit-Protokoll für Rollen, Mitgliedschaften, Einladungen, Sicherheitseinstellungen und Verknüpfungen. | IMPLEMENTIERT | `audit_events` je Firma (wer, was, wen, wann; Namen zum Zeitpunkt kopiert), Anzeige für Dispatcher unter Konto → Protokoll (`GET /api/auth/audit`). Zwei-Faktor und Google/Microsoft der eigenen Person gehören zum Konto und stehen nicht im Firmen-Protokoll. Eine Aufbewahrungsfrist fehlt noch. Test: `audit.test.ts`. |
| A4.5 | Keine Rotation für `TOTP_ENCRYPTION_KEY` (verschlüsselt TOTP- und OIDC-Secrets). | OFFEN | Versionierte Schlüssel (`kid` im gespeicherten Wert) und ein Umschlüssel-Skript. |
| A4.6 | Microsoft-Konten lassen sich nur verknüpfen, wenn der Token `email_verified` liefert; Entra liefert das meist nicht. | OFFEN | Für Entra ID die verifizierte Domain (`xms_edov`) oder eine Mandantenbindung auswerten. Bis dahin verknüpft Microsoft praktisch nicht (wie vorher schon bei der E-Mail-Zuordnung). |
| A4.7 | Knopf zum Verknüpfen von Google/Microsoft auf der Kontoseite. | OFFEN | API steht (`POST /api/auth/sso/link`); sichtbare Änderung, braucht einen Canvas-Entwurf. |
| A4.8 | Das Limit je E-Mail beim Login (8 Fehlversuche in 15 Min) sperrt auch die echte Person aus. | IMPLEMENTIERT | Verzögerung statt Sperre (`lib/loginAttempts.ts`): fünf Fehlversuche frei, danach wartet der nächste Versuch 2, 4, 8 … höchstens 60 Sekunden (`429` `LOGIN_SLOW_DOWN`, `Retry-After`); das richtige Passwort setzt zurück. Wer rät, schafft etwa einen Versuch pro Minute, die echte Person wartet höchstens eine Minute. Das IP-Limit bleibt. Test: `loginSlowdown.test.ts`. |
| A4.9 | Cookie-Präfix `__Host-` für das Sitzungscookie. | OFFEN | Optional; meldet beim Umstellen alle ab. |
| A4.10 | `autocannon` (devDependency, nur für `npm run bench`) zieht `uuid`/`hyperid` mit mittlerer Schwachstelle. | OFFEN | Behebung nur per Major-Downgrade; läuft nicht in der Anwendung. |

---

## B. Anforderungen an die Infrastruktur

Nicht im Code lösbar; Voraussetzung für einen echten Betrieb.

| # | Anforderung |
| --- | --- |
| B1 | HTTPS vor der API und der Web-App; `NODE_ENV=production` (setzt `Secure` am Cookie und die Origin-Prüfung). |
| B2 | `CORS_ORIGIN` und `WEB_ORIGIN` auf die echte Origin (die Produktion startet mit `*` nicht). |
| B3 | `TOTP_ENCRYPTION_KEY`: zufällig (mindestens 32 Byte), aus einem Secret-Speicher, nicht in Repo oder Backup der Datenbank. Ebenso die Google-/Microsoft-Client-Secrets. |
| B4 | `TRUST_PROXY_HOPS` genau auf die Zahl der Proxies, die `X-Forwarded-For` überschreiben; sonst 0. |
| B5 | Eine Instanz. Rate-Limits, TOTP-Fehlversuche, SSE-Hub und Import-Vorschauen liegen im Prozess; mehrere Instanzen bräuchten einen gemeinsamen Speicher (z. B. Redis) und ein Broadcast für SSE. |
| B6 | SQLite-Datei und `-wal`/`-shm` nur für den Dienstnutzer lesbar; Backups über die SQLite-Backup-API, verschlüsselt und getrennt vom Schlüssel aus B3. Sie enthalten Passwort-Hashes, Token-Hashes, verschlüsselte TOTP- und OIDC-Geheimnisse. |
| B7 | Security-Header für die ausgelieferte Web-App (CSP, HSTS, `frame-ancestors`, `Referrer-Policy`); `helmet` schützt nur die API-Antworten. |
| B8 | Logs: Aufbewahrung festlegen; sie enthalten Request-URLs (u. a. OIDC-Callbacks mit Einmal-Code) und Personen-IDs, keine Cookies. |
| B9 | SMTP mit TLS (`SMTP_URL`), Absender-Domain mit SPF/DKIM. |
| B10 | `OIDC_PRIVATE_HOSTS` nur für einen bekannten internen IdP; jeder Eintrag ist eine bewusste Ausnahme vom SSRF-Schutz. |
| B11 | Meldeweg für Schwachstellen festlegen (`SECURITY.md`). |

## C. Grenzen der Demo

| # | Grenze |
| --- | --- |
| C1 | Demo-Konten mit bekanntem Passwort (`ALLOW_DEMO_ACCOUNTS`, lokal an). Die Produktion startet nicht, solange sie existieren. |
| C2 | Außerhalb der Produktion: fester Entwicklungsschlüssel für TOTP, keine Origin-Prüfung, kein pauschales API-Limit, Mail-Links im Server-Log. |
| C3 | Der Simulator schreibt Positionen; es gibt keine echten Tracker und keine Geräte-Authentifizierung. |
| C4 | Sitzungen ohne „Angemeldet bleiben“ enden 15 Minuten nach der letzten Anfrage; ein offener Live-Strom verlängert sie nicht und endet mit ihr. |

---

## Verhaltensänderungen durch diese Härtung

* Externe Logins melden nur noch nach ausdrücklicher Verknüpfung an. Alte Verknüpfungen gelten nicht mehr (`sso_identities_legacy`).
* Nach Google, Microsoft oder Firmen-Login fragt die Anmeldung nach dem zweiten Faktor, wenn Konto oder Firma ihn verlangen.
* Eine Firmen-Login-Sitzung bleibt in ihrer Firma; für eine andere Firma meldet man sich neu an.
* Verlangt eine Firma neu Zwei-Faktor oder ihren Login, enden die Sitzungen, die das nicht erfüllen. Wer Zwei-Faktor für das eigene Konto einschaltet, wird in den anderen Sitzungen ohne Faktor abgemeldet.
* „Firmen-Login verlangen“ setzt eine eigene Verknüpfung (oder eine Firmen-Login-Sitzung) voraus; Issuer und Client lassen sich nur bei ausgeschalteter Pflicht ändern.
* Ein Wiederherstellungscode lässt den zweiten Faktor eingeschaltet.
* Neue Variablen: `OIDC_PRIVATE_HOSTS`, `TRUST_PROXY_HOPS`. Neuer Endpoint: `POST /api/auth/sso/link`. Neue Codes: `REAUTH_REQUIRED`, `TOTP_REQUIRED`, `SSO_LINK_REQUIRED`, `STREAM_LIMIT`.
