# Lokale Entwicklung

Zurück zur [README](../README.md).

## Voraussetzungen

* Node.js
* npm

```bash
npm install
npm run dev
```

Nur API: `npm run dev:api`. Nur Web: `npm run dev:web`.

Seed:

```bash
npm run db:seed
```

Großer Satz (Zehntausende Fahrzeuge):

```bash
npm run db:seed:large
```

Tests:

```bash
npm test
npm run test:web
```

`npm run verify` macht Typecheck, beide Testsuiten, Lint und Production-Build. Bench: `npm run bench` (`apps/api/scripts/bench.ts`).

Nach `db:seed` kann die Loginseite in der Entwicklung `cihan@example.com` / `development-only-password` vorausfüllen (Dispatcher, Rheinland Logistik). `viewer@example.com` gleiches Passwort, nur Lesen. Beide Firma 1. Der Seed legt trotzdem Fahrzeuge für Firma 2 und 3 an. Die haben keinen Demo-User. Isolation in der UI ist eine fremde ID und dann „nicht gefunden“. `db:seed:large` packt fast alles auf Firma 1, Firma 2 und 3 bekommen je etwa 1 %. Nur migrierte alte DBs behalten alle Fahrzeuge auf Firma 1.

| Variable | Standard | Hinweise |
| -------- | -------- | -------- |
| `PORT` | `3000` | |
| `DATABASE_PATH` | `apps/api/data/fleetlive.db` | `:memory:` in Tests |
| `CORS_ORIGIN` | `*` | Same origin über den Vite-Proxy |
| `TELEMETRY_TICK_MS` | `1000` | Wie oft nach fälligen Meldungen gesucht wird. `0` schaltet den Simulator aus |
| `PING_INTERVAL_MS` | `5000` | Abstand der Meldungen je Fahrzeug (60 bis 160 % davon) |
| `TELEMETRY_BATCH_SIZE` | `3000` | Höchstens so viele Meldungen pro Tick |
| `TELEMETRY_KEEP_PER_VEHICLE` | `100` | Nur Live-Puffer |
| `TRIP_RETENTION_DAYS` | `90` | Abgeschlossene Fahrten älter als das werden gelöscht, solange die Firma unter Konto → Datenschutz nichts eingestellt hat. `0` behält sie |
| `IMPORT_FALLBACK_LATITUDE` | `50.9375` | Startpunkt beim Import, wenn die Firma kein Depot hat (Köln) |
| `IMPORT_FALLBACK_LONGITUDE` | `6.9603` | |
| `LOG_LEVEL` | `info` | |
| `NODE_ENV` | keiner, muss gesetzt sein | `development`, `test` oder `production`. Ohne Wert startet der Prozess nicht. Lokal setzt `apps/api/dev.env` (von den npm-Skripten geladen) `development`. API-Pauschallimit nur in Produktion. Login-Limit auch in der Entwicklung |
| `ALLOW_DEMO_ACCOUNTS` | `false` | Legt beim Start die Demo-Konten mit bekanntem Passwort an (nur außerhalb von Produktion) und erlaubt sie unter `NODE_ENV=production`. Lokal in `apps/api/dev.env` auf `true` |
| `SMTP_URL` | leer | Nodemailer-URL, z. B. `smtp://user:pass@localhost:1025`. Ohne Wert: Link nur im Server-Log. Produktion ohne Wert: `503` |
| `MAIL_FROM` | `fleet-live <noreply@localhost>` | Absender |
| `WEB_ORIGIN` | `http://localhost:5173` | Origin der UI. Mail-Links und OIDC-Redirects. Vite bindet fest Port 5173 |
| `TOTP_ENCRYPTION_KEY` | Dev-Schlüssel | In Produktion Pflicht |
| `GOOGLE_CLIENT_ID` | leer | Zusammen mit `GOOGLE_CLIENT_SECRET`. Sonst kein Google-Button |
| `GOOGLE_CLIENT_SECRET` | leer | |
| `MICROSOFT_CLIENT_ID` | leer | Zusammen mit `MICROSOFT_CLIENT_SECRET`. Sonst kein Microsoft-Button |
| `MICROSOFT_CLIENT_SECRET` | leer | |
| `OIDC_PRIVATE_HOSTS` | leer | Hostnamen von Firmen-IdPs, die auf interne Adressen zeigen dürfen (kommagetrennt, exakt). Sonst gehen OIDC-Anfragen nur per HTTPS an öffentliche Adressen |
| `TRUST_PROXY_HOPS` | `0` | Anzahl Proxies, die `X-Forwarded-For` überschreiben. `0`: der Header wird ignoriert |

Google und Microsoft sind OpenID Connect gegen feste Issuer (`https://accounts.google.com` bzw. `https://login.microsoftonline.com/common/v2.0`). Im IdP als Redirect-URI eintragen:

* `{WEB_ORIGIN}/api/auth/sso/google/callback`
* `{WEB_ORIGIN}/api/auth/sso/microsoft/callback`
* Firmen-IdP: `{WEB_ORIGIN}/api/auth/sso/company/callback`

Verknüpft wird nur, wenn der Anbieter die E-Mail des Kontos als bestätigt meldet. Google sendet dafür `email_verified`. Microsoft Entra ID sendet das meist nicht; dort in der App-Registrierung unter „Token configuration“ die optionalen Claims `email` und `xms_edov` für das ID-Token hinzufügen. `xms_edov` sagt, dass der Mandant die Domain der E-Mail bestätigt hat ([Microsoft: Optional claims reference](https://learn.microsoft.com/en-us/entra/identity-platform/optional-claims-reference)). Das gilt auch für einen Firmen-Login über Entra.

Damit die Anmeldeseite den Firmen-Login über die E-Mail findet, trägt ein Dispatcher unter Konto → Firmen-Login die Domain der Firma ein und legt im DNS einen TXT-Eintrag `_fleet-live.<domain>` mit dem angezeigten Wert an; „Prüfen“ fragt ihn ab (`lib/dnsTxt.ts`, 5 s, zwei Versuche). In Tests ersetzt `setTxtLookupForTests` die Abfrage.

Der Firmen-Issuer auf der Kontoseite ist die URL, unter der `/.well-known/openid-configuration` liegt (Entra: `https://login.microsoftonline.com/<Mandanten-ID>/v2.0`). Das ist nicht dasselbe wie die Google-/Microsoft-Buttons, die über die Umgebungsvariablen laufen.
