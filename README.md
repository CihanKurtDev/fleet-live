# fleet-live 🚚

> Lokale Portfolio-Demo

Flottenleitstelle für Dispatcher. Schichtüberblick, Live-Karte, Fahrten, Fahrer, Warnungen und Stammdatenimport in einer App. TypeScript-Monorepo, serverseitige Listen, SSE mit Fokus, Mandantentrennung, SQLite. GPS kommt aus dem Simulator, absichtlich, damit die Demo lokal und reproduzierbar bleibt.

## Einblicke

### Live-Flottenkarte

![Flottenkarte mit Statusmarkern](docs/screenshots/fleet-map.png)

### Schichtüberblick

![Schichtüberblick mit Kennzahlen und Monatsverlauf](docs/screenshots/briefing.png)

### Warnungs-Inbox

![Filterbare Warnungs-Inbox](docs/screenshots/alerts.png)

### Fahrzeug und Fahrt

![Fahrzeugdetail mit Live-Fahrt](docs/screenshots/vehicle-detail.png)

### Stammdatenimport

![Importvorschau mit Prüfung, Blättern und Zeilenaktionen](docs/screenshots/import-preview.png)

## In fünf Minuten starten

Node.js 24 und npm 11.

```bash
npm ci
npm run db:seed
npm run dev
```

Dann `http://localhost:5173` öffnen.

- Dispatcher: `cihan@example.com`
- Viewer: `viewer@example.com`
- Passwort für beide: `development-only-password`

Qualitätslauf:

```bash
npm run verify
```

## Architektur in Kürze

```text
React 19 + Vite ── HTTP + SSE /api ──▶ Express 5
        │                                  │
        └──── @fleet-live/shared ──────────┤
                                           ▼
                                  Models ──▶ SQLite
```

Routes und Controller machen HTTP. Models machen SQL. Der Browser fasst die Datenbank nicht an. `@fleet-live/shared` hält Domain-Typen, Zod, Listen, Auth und SSE.

## Warum so gebaut

- Telemetrie kommt aus dem Simulator. Kein GPS-Dongle, keine Cloud.
- SQLite und ein Monolith, weil das für eine lokale Demo reicht.
- Eine Person kann in mehreren Firmen sein. Die aktive Firma steht in der Session.
- Cookie-Session über den Vite-Proxy (same origin). Hier gibt es kein öffentliches Hosting.
- Große Kartenausschnitte werden auf dem Server zu Dichtezellen. Es kommt keine Stichprobe von Markern.

[Demo-Skript](docs/demo-script.md): 60 bis 90 Sekunden durch Login, Briefing, Dichtekarte, Live-Fahrt, Warnungen und Import.

---

# Produktumfang

Was die App heute kann, und was als Nächstes kommt.

## Jetzt

* Geschwindigkeitswarnung, solange ein Fahrzeug über dem Streckenlimit liegt
* Niedriger Tankstand aus der aktuellen Messung, plus geseedete Warnungshistorie
* Funk-Ausfall, wenn ein Fahrzeug verstummt oder offline gemeldet ist
* Inbox offen oder erledigt, Filter nach Geschwindigkeit, Tank, Funk
* Schichtüberblick auf der Startseite, offene Warnungen in der Navigation
* Flottenkarte mit Dichtezellen und Kennzeichen-Sprung, Fahrspur am Fahrzeug, Fahrer, Firmen-Login
* Fahrtarchiv am Fahrzeug: alte Fahrten durchblättern, abgeschlossene Strecke auf der Karte
* Fahrzeuge, Fahrer, Freigaben und aktuelle Besatzung aus CSV oder Excel (`/vehicles/import`)
* Letzte Spaltenzuordnung bleibt pro Firma gespeichert, jeder Import steht im Log
* Hof-Stammdaten am Fahrzeug: VIN, Typ, HU-Fälligkeit, Depot, Kostenstelle
* Fahrer mit Telefon, Umbenennen ohne Fahrzeugformular, Liste mit auffälligen Fahrern zuerst
* Depots als benannte Kreise auf der Flottenkarte, Stammstandort am Fahrzeug, Filter „Im Depot“
* Firma registrieren, E-Mail bestätigen, Passwort zurücksetzen und ändern
* Dispatcher und Viewer einladen, zwischen eigenen Firmen wechseln
* Zwei-Faktor (Authenticator-App) und Anmeldung über Google, Microsoft oder einen Firmen-OIDC
* Leere Firma fragt einmal, ob Stammdaten importiert werden sollen

## Als Nächstes

* Erinnerungen zu HU, Führerschein, UVV
* CSV-Export

---

# Tech-Stack

**Backend:** Node.js, TypeScript, Express 5, SQLite (`node:sqlite`)

**Frontend:** React 19, TypeScript, Vite, React Router, Sass / CSS Modules, Leaflet

**Shared:** `@fleet-live/shared` (snake_case, Zod, Listen, Flotte, SSE, Sim, Auth, Polyline)

**Entwicklung:** npm workspaces, tsx, ESLint, `node:test` + SuperTest, autocannon

---

# API

Fahrzeug, Stream und Sim brauchen eine Session. `GET /api/health` nicht. `error` und `fields` auf Deutsch, `code` auf Englisch.

## Auth

| Methode | Endpoint | Beschreibung |
| ------- | -------- | ------------ |
| `POST` | `/api/auth/register` | Firma plus erster Dispatcher. Keine Session, bis die E-Mail bestätigt ist |
| `POST` | `/api/auth/verify-email` | `{ token }` |
| `POST` | `/api/auth/resend-verification` | `{ email }`, gleiche Antwort ob das Konto existiert |
| `POST` | `/api/auth/login` | `{ email, password, remember? }`. Session, oder `{ step, challenge }` für Zwei-Faktor |
| `POST` | `/api/auth/totp` | `{ challenge, code }` setzt danach die Session |
| `POST` | `/api/auth/forgot-password` | `{ email }`, gleiche Antwort ob das Konto existiert |
| `POST` | `/api/auth/reset-password` | `{ token, password }`, beendet alle Sessions |
| `POST` | `/api/auth/logout` | Löscht die Session |
| `GET`  | `/api/auth/me` | Aktueller Nutzer inklusive `company_name`, `memberships` oder `401` |
| `POST` | `/api/auth/company` | Aktive Firma wechseln |
| `POST` | `/api/auth/companies` | Weitere Firma anlegen und dorthin wechseln |
| `POST` | `/api/auth/invites` | Dispatcher lädt `{ email, role }` ein |
| `GET`  | `/api/auth/sso/providers` | `{ google, microsoft }` — nur `true`, wenn Client-ID und Secret gesetzt sind |
| `GET`  | `/api/auth/sso/google/start` | Weiterleitung zu Google. Microsoft und `/sso/company/start` analog |

`remember: true` hält das Cookie sieben Tage. Sonst zwölf Stunden, Cookie nur für die Sitzung. Falsches Passwort ist `401`, ohne zu sagen welches Feld. Passwort mindestens 12 und höchstens 128 Zeichen. Ohne `SMTP_URL` schreibt die Entwicklung den Reset-Link ins Server-Log und sagt das in der Antwort; es geht keine Mail raus. Produktion ohne SMTP antwortet `503`. Die Anmeldeseite zeigt Google und Microsoft nur, wenn die jeweiligen Client-Variablen gesetzt sind.

## Fahrzeuge und Livedaten

| Methode  | Endpoint                         | Beschreibung |
| -------- | -------------------------------- | ------------ |
| `GET`    | `/api/vehicles`                  | Liste (`search`, `filter`, `sort`, `dir`, `page`, `limit`) |
| `GET`    | `/api/vehicles/positions`        | Letzte Positionen für die Karte (`bbox`, `search`, `filter`, `drivers`) |
| `GET`    | `/api/vehicles/drivers`          | Fahrersuche (`search`, `page`; `names` lädt eine Auswahl nach) |
| `GET`    | `/api/vehicles/:id`              | Ein Fahrzeug. `404` wenn weg oder andere Firma |
| `GET`    | `/api/vehicles/:id/telemetry`    | Letzte Punkte (`limit` 10, 25, 50, 100, Standard 50) |
| `GET`    | `/api/vehicles/:id/trips/latest` | Laufende Fahrt, sonst die letzte abgeschlossene. `data: null` wenn nie gefahren |
| `GET`    | `/api/vehicles/:id/trips`        | Archiv ohne `path` |
| `GET`    | `/api/vehicles/:id/trips/:tripId`| Eine Fahrt inklusive `path`. `404` wenn weg oder andere Firma |
| `POST`   | `/api/vehicles`                  | Anlegen, `Location` bei `201`. `company_id` aus der Session |
| `PUT`    | `/api/vehicles/:id`              | Ersetzen |
| `PATCH`  | `/api/vehicles/:id`              | Aktualisieren |
| `DELETE` | `/api/vehicles/:id`              | Löschen |
| `GET`    | `/api/stream`                    | SSE: `connected` (`connection_id`), Telemetrie, `vehicles-changed` |
| `POST`   | `/api/stream/focus`              | `{ connection_id, ids }`. Nur Fahrzeuge dieser Firma, Verbindung muss dazugehören |
| `GET`    | `/api/sim`                       | `{ running, available }` für diese Firma |
| `PATCH`  | `/api/sim`                       | `{ running }`, Sim dieser Firma pausieren oder fortsetzen |
| `GET`    | `/api/alerts`                    | Warnungen (`filter` open/resolved/all, optional `type`, `vehicle_id`, `driver_id`, `page`, `limit`) |
| `PATCH`  | `/api/alerts/:id`                | `{ resolved: true }`, nur `dispatcher` |
| `GET`    | `/api/briefing`                  | Snapshot für die Startseite |
| `GET`    | `/api/drivers`                   | Fahrer (`search`, `page`, `limit`, optional `vehicle_id`). Sortierung: offene Warnungen |
| `POST`   | `/api/drivers`                   | `{ name, phone? }`, `dispatcher` |
| `GET`    | `/api/drivers/:id`               | Fahrer, Freigaben, aktuelles Fahrzeug. `404` wenn weg oder andere Firma |
| `PATCH`  | `/api/drivers/:id`               | `{ name?, phone? }`, `dispatcher` |
| `POST`   | `/api/drivers/:id/vehicles`      | `{ vehicle_id }`, Freigabe, `dispatcher` |
| `DELETE` | `/api/drivers/:id/vehicles/:vehicleId` | Freigabe weg, `dispatcher` |
| `PATCH`  | `/api/drivers/:id/current-vehicle` | `{ vehicle_id }` oder `{ vehicle_id: null }`, `dispatcher` |
| `GET`    | `/api/health`                    | `{ status: "ok" }` |

`GET /api/vehicles` gibt `{ data, meta }`. In `meta`: `total`, `pageCount`, Facetten `counts` (`all`, `alerts`, `low_fuel`, `driving`, `offline`).

`GET /api/alerts` gibt Warnungen mit Kennzeichen und dem Fahrer zum Zeitpunkt des Öffnens (`driver_id` / `driver_name`). Dazu `ended_at` und `details` (SPEEDING: `{ limit_kmh, max_speed_kmh, duration_s }`). Standardfilter `open` heißt `resolved_at IS NULL`. `ended_at` spielt dafür keine Rolle. `type` optional: `SPEEDING`, `LOW_FUEL`, `OFFLINE`. `meta.counts` ist `open` / `resolved` / `all` und ignoriert `type`. `meta.type_counts` hängt am Filter. `vehicle_id` oder `driver_id` optional, sonst 404 wenn fremd. Umbesetzung ändert alte Zeilen nicht.

`GET /api/drivers` listet Fahrer der Session-Firma. `counts` und `open_warnings` zählen nur SPEEDING (über den Snapshot `alerts.driver_id`). `vehicle_plate` nur wenn genau ein freigegebenes Fahrzeug. `current_vehicle_plate` ist das Fahrzeug mit `current_driver_id`. Mit `vehicle_id` kommen die Fahrer, die für dieses Fahrzeug frei sind. `GET /api/drivers/:id` hängt `vehicles` (`is_current`) und `current_vehicle` an.

`GET /api/briefing` gibt Statuszähler (`driving`, `idle`, `offline`), Inbox `open`, `low_fuel` und monatliche `history` für die Diagramme. `viewer` darf lesen.

`GET /api/vehicles/positions` ist entweder `positions` oder `density`, plus `meta.total`. `bbox=west,south,east,north` optional. `search` trifft Kennzeichen und Fahrer in der ganzen Firma. `drivers` filtert nur die Ansicht. Bis `FLEET_POSITIONS_MAX` (2000) kommen Einzelpositionen. Darüber höchstens 32 mal 20 Zellen mit Statuszählern.

Query-Parameter stehen in `@fleet-live/shared`. Kaputte Sortierung oder Limits: `400`. Seitengröße 10, erlaubt 10, 25, 50, 100. Kennzeichen max. 32 Zeichen, Fahrername max. 80. Beides eindeutig pro Firma.

Validierung:

```json
{
  "error": "Tankstand muss zwischen 0 und 100 liegen.",
  "code": "VALIDATION_ERROR",
  "fields": {
    "fuel_level": "Tankstand muss zwischen 0 und 100 liegen."
  }
}
```

Fahrzeug-JSON: letzte Telemetrie oder `null`, `speed_limit_kmh`, `active_alerts`, `speeding_open`, `current_driver_id`, `driver_name` (null im Pool), Hof-Felder `vin`, `vehicle_type`, `hu_due_on`, `depot`, `cost_center`. Anlegen und Update nehmen Kennzeichen, Tank, Status und Hof-Felder. Keinen Fahrernamen. Zuweisung läuft über `/api/drivers`.

---

# Fahrzeugmodell

Was ein Mensch pflegt: Kennzeichen, VIN, Typ, HU-Fälligkeit, Depot, Kostenstelle. Tankstand, wenn das Fahrzeug nicht fährt. Wer fahren darf und wer es gerade hat, hängt an der Fahrer-API, nicht am Fahrzeugformular. `status` kommt vom Fahrzeug (`DRIVING`, `IDLE`, `STOPPED`, `OFFLINE`) und ist kein Formularfeld. `fuel_level` wird während `DRIVING` gemessen, sonst von Hand.

Zusätzlich in der Antwort: Position, Geschwindigkeit, `speed_limit_kmh`, `recorded_at`, `active_alerts`, `speeding_open`, `created_at`.

`company_id` setzt die Session beim Anlegen. Der Client wählt sie nicht.

---

# Frontend

Vite schickt `/api` nach `http://localhost:3000`. `fetch` und EventSource laufen same origin mit `credentials: "include"`.

Listenstand steht in der URL. Reload behält die Ansicht. Frischer Besuch von `/vehicles` startet auf Seite 1.

| Route           | Beschreibung |
| --------------- | ------------ |
| `/login`        | Login, Links zu Registrierung und Passwort vergessen |
| `/registrieren` | Firma anlegen |
| `/passwort-vergessen` | Link anfordern |
| `/passwort-zuruecksetzen` | Neues Passwort |
| `/email-bestaetigen` | E-Mail-Link |
| `/einladung` | Einladung annehmen |
| `/konto` | Passwort, Zwei-Faktor, Einladungen, Firmen-Login |
| `/`             | Schichtüberblick |
| `/vehicles`     | Liste, Anlegen |
| `/vehicles/:id` | Detail, Karte, Zuweisung, Warnungen, Bearbeiten, Löschen |
| `/fleet`        | Flottenkarte |
| `/alerts`       | Inbox (offen/erledigt, optional `type`, `vehicle_id` / `driver_id`) |
| `/drivers`      | Fahrerliste |
| `/drivers/:id`  | Fahrer, Freigaben, aktuelles Fahrzeug, SPEEDING-Historie |

Ohne Session landet man auf `/login`. Danach ist `/` die Startseite.

## Schichtüberblick

Fünf Zahlen: offene Inbox, Funk-Ausfall, fahrend, bereit, niedriger Tank. Dazu die neuesten offenen Warnungen (Dispatcher kann erledigen), Fahrzeuge mit `OFFLINE`, Fahrer mit den meisten offenen Warnungen. Die Navigation zeigt den Inbox-Zähler. `viewer` liest, `dispatcher` erledigt.

## Fahrzeugliste

Normale Tabelle. Spalten und Filter sind Konfiguration. Suche, Filter, Sortierung und Seiten laufen auf dem Server. Live-Patches treffen die aktuelle Seite und die Nachbarn.

## Fahrzeugverwaltung

Anlegen, bearbeiten, löschen. Status als Badge. Tank während der Fahrt nur lesen. Der Header pausiert den Simulator dieser Firma und wechselt zwischen Liste und Karte.

## Flottenkarte

`/fleet` lädt Positionen der eigenen Firma im sichtbaren Ausschnitt. Der Fahrer-Picker ist ein Filter, kein Muss. Status-Chips und Kennzeichensuche gelten für diesen Ausschnitt. Über 2000 Treffer werden Dichtekreise. Klick zoomt, bis Marker gehen. Ein eindeutiges Kennzeichen holt das Fahrzeug auch von außerhalb. Fahrende Fahrzeuge im Positionsmodus kriegen SSE (max. 150 im Fokus). Spuren gibt es hier nicht, die liegen auf der Detailseite.

Tabellenkomponente: [apps/docs/table.md](apps/docs/table.md).

---

# Telemetrie

Kurzer Puffer: Fahrzeug, Latitude, Longitude, Geschwindigkeit, `recorded_at`. Der letzte Punkt steckt im Fahrzeug-JSON. `GET /api/vehicles/:id/telemetry` gibt `{ data }` chronologisch. Das ist Marker und letzte Bewegung, nicht die Spur.

Der Ticker schreibt nur für fokussierte `DRIVING`-Fahrzeuge, deren Firma die Sim laufen lässt. `connected` liefert `connection_id`. Die UI schickt `{ connection_id, ids }` (Liste plus Nachbarn, offenes Detail, fahrende auf der Flottenkarte). Jede Verbindung hat eigenen Fokus. Der Ticker nimmt die Vereinigung der laufenden Sims dieser Firma. Ohne Fokus passiert nichts. Patches nur an Verbindungen, die die ID fokussiert haben und zur Firma gehören. `vehicles-changed` nur an diese Firma.

Pro Fahrzeug bleiben `TELEMETRY_KEEP_PER_VEHICLE` Rohzeilen (Standard 100). Das ist die Retention. Trip-Ende schreibt Speed 0 an der letzten Position.

Fokussierte Fahrzeuge fahren auf eingebackenen OSRM-Linien. Tempo nach Stadt/Autobahn plus etwas Rauschen. Zeitskala so, dass ein typischer Korridor in 1 bis 2 Minuten durch ist.

## Fahrten

Eine Fahrt ist der Datensatz einer Fahrt. Ein Fenster aus Rohpunkten wäre die falsche Einheit. Dann würde die sichtbare Länge von der Tickrate abhängen.

Jede Position kommt an `trips.path` als [kodierte Polyline](https://developers.google.com/maps/documentation/utilities/polylinealgorithm) (Präzision 5).

* Anhängen ist O(1): `path = path || ?`, Vorgänger in `last_latitude` / `last_longitude`. Unter 20 m Abstand fliegt der Punkt raus.
* Beim Schließen vereinfacht Ramer-Douglas-Peucker auf 12 m.
* `distance_m` ist die Summe der gemeldeten Segmente, nicht die vereinfachte Linie.

Zugriff: `trip → vehicle → company`. Kein `company_id` auf `trips`, kein `GET /api/trips/:id`. Die Liste lässt `path` weg. Die Linie kommt mit `GET /api/vehicles/:id/trips/:tripId`.

Abgeschlossene Fahrten älter als `TRIP_RETENTION_DAYS` (90) werden pro Firma gelöscht. Offene bleiben. Prune nach Trip-Close und nach Ticks für die Firmen im Batch. `TRIP_RETENTION_DAYS=0` schaltet das aus.

Kompromisse:

* Keine Speed- oder Zeitreihe auf der Polyline. Aggregate liegen an der Fahrt.
* Distanz und Höchstgeschwindigkeit nur bei abgeschlossenen Fahrten, einmal geladen.
* Die Zeile wird bei jedem Append neu geschrieben. Bei mehr Last wäre Chunking der nächste Schritt.

---

# Warnungen, Hinweise, Verstöße

Drei Schichten, eine Tabelle `alerts`.

* **Indikator.** `speedBand` und `speeding_open`. Orange über `speed_limit_kmh` ohne offenes Event. Rot, solange SPEEDING `ended_at` null hat. Nur bei `DRIVING`. Nach Event-Ende ist die Zelle wieder normal, auch wenn die Inbox-Zeile noch offen ist.
* **Warnung.** `resolved_at IS NULL`. Inbox `/alerts`. Dispatcher quittiert per `PATCH`. `ended_at` ist nicht dasselbe wie erledigt.
* **Verstoßhistorie.** SPEEDING-Zeilen, auch erledigte, gezählt pro Snapshot-Fahrer auf `/drivers`. Tank und Funk bleiben am Fahrzeug. `resolved_at` heißt gesehen, nicht „war nie“.

`alerts` hängt an `vehicle_id`. Zugriff über `alert → vehicle → company`. `driver_id` wird beim Öffnen aus `vehicles.current_driver_id` kopiert und danach nicht mehr angefasst. `active_alerts` ist der offene Zähler am Fahrzeug und im Listenfilter.

`GET /api/alerts` ist die Inbox. Standard `filter=open`. Optional `type`, `vehicle_id`, `driver_id`. `PATCH` mit `{ resolved: true }` schließt (`dispatcher`). Zweites Schließen ist egal. Viewer lesen. Nach dem Close kommt `vehicles-changed`.

Ticker SPEEDING: 8 s am Stück über dem Sim-Limit (`speedLimitKmh`, Stadt 50 / Autobahn 120). Eine offene Zeile pro Fahrzeug. `details` mit Limit, Max, Dauer. 2 s Hysterese oder raus aus `DRIVING` setzt `ended_at`. Jedes achte simulierte Fahrzeug darf über dem Limit fahren. OFFLINE nach 15 s ohne Ticks bei pausierter Sim, oder Status `OFFLINE`. Niedriger Tank ist Messung und Filter. LOW_FUEL in der Inbox kommt aus dem Seed. Eine offene Zeile pro Fahrzeug und Typ. Anzeige: `formatAlertEvent`. Fahrernamen gehen nach `/drivers/:id`. Klick auf die Warnung öffnet das Fahrzeug.

Live-Speed sitzt in der Telemetrie. Die Polyline hat keinen Speed pro Punkt.

---

# Fahrer

Eigene Entität, Name eindeutig pro Firma. Freigabe ist `driver_vehicles` (M:N). Aktuell höchstens ein Fahrzeug (`vehicles.current_driver_id`). `NULL` heißt Pool. `driver_name` am Fahrzeug ist der aktuelle Name oder `NULL`.

`POST /api/drivers` legt an (`name`, optional `phone`). `PATCH` ändert Name oder Telefon. Umbenennen schreibt `vehicles.driver_name` mit, wenn der Fahrer aktuell ist. Zuweisen hängt am Fahrer, nicht am Fahrzeug-Write. `GET /api/drivers` sortiert nach offenen SPEEDING-Warnungen und zählt SPEEDING inklusive erledigter. `GET /api/vehicles/drivers` ist nur der Namensfilter auf der Karte.

---

# Datenbank

```text
companies
users
company_memberships → user_id, company_id, role
sessions       → user_id, company_id
drivers        → company_id   UNIQUE (company_id, name)
driver_vehicles → driver_id, vehicle_id
vehicles       → company_id, current_driver_id   UNIQUE (company_id, license_plate)
telemetry      → vehicle_id
trips          → vehicle_id   (eine offene Fahrt pro Fahrzeug)
alerts         → vehicle_id, driver_id (Snapshot beim Öffnen)
```

Partieller Unique-Index `trips(vehicle_id) WHERE ended_at IS NULL`: eine offene Fahrt gleichzeitig.

---

# Authentifizierung und Mandanten

Da:

* Login, Logout, me
* scrypt
* HttpOnly-Cookie
* Isolation über die aktive Mitgliedschaft (`company_memberships`, Session-Firma)
* `dispatcher` schreibt, pausiert die Sim, erledigt Warnungen, weist Fahrer zu. `viewer` liest.
* SSE und Sim-Pause an diese Firma gebunden

Registrierung, Passwort-Reset, Einladung, mehrere Firmen pro Person, Zwei-Faktor und OIDC sind da. CORS `*` nur lokal. Produktion ohne gesetzten Origin startet nicht und prüft den Origin bei Schreibzugriffen. Produktion braucht `TOTP_ENCRYPTION_KEY`. SMTP über `SMTP_URL`, Absender `MAIL_FROM`, Links über `WEB_ORIGIN`. Google und Microsoft über die jeweiligen Client-Variablen.

---

# Lokale Entwicklung

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
| `TELEMETRY_TICK_MS` | `400` | `0` schaltet den Simulator aus |
| `TELEMETRY_BATCH_SIZE` | `32` | Cap pro Tick über die Fokus-IDs |
| `TELEMETRY_KEEP_PER_VEHICLE` | `100` | Nur Live-Puffer |
| `TRIP_RETENTION_DAYS` | `90` | Abgeschlossene Fahrten älter als das, pro Firma. `0` aus |
| `LOG_LEVEL` | `info` | |
| `NODE_ENV` | `development` | API-Pauschallimit nur in Produktion. Login-Limit auch in der Entwicklung |
| `ALLOW_DEMO_ACCOUNTS` | `false` | Für Demo-Seed unter `NODE_ENV=production` auf `true` setzen |
| `SMTP_URL` | leer | Nodemailer-URL, z. B. `smtp://user:pass@localhost:1025`. Ohne Wert: Link nur im Server-Log. Produktion ohne Wert: `503` |
| `MAIL_FROM` | `fleet-live <noreply@localhost>` | Absender |
| `WEB_ORIGIN` | `http://localhost:5173` | Origin der UI. Mail-Links und OIDC-Redirects. Vite bindet fest Port 5173 |
| `TOTP_ENCRYPTION_KEY` | Dev-Schlüssel | In Produktion Pflicht |
| `GOOGLE_CLIENT_ID` | leer | Zusammen mit `GOOGLE_CLIENT_SECRET`. Sonst kein Google-Button |
| `GOOGLE_CLIENT_SECRET` | leer | |
| `MICROSOFT_CLIENT_ID` | leer | Zusammen mit `MICROSOFT_CLIENT_SECRET`. Sonst kein Microsoft-Button |
| `MICROSOFT_CLIENT_SECRET` | leer | |

Google und Microsoft sind OpenID Connect gegen feste Issuer (`https://accounts.google.com` bzw. `https://login.microsoftonline.com/common/v2.0`). Im IdP als Redirect-URI eintragen:

* `{WEB_ORIGIN}/api/auth/sso/google/callback`
* `{WEB_ORIGIN}/api/auth/sso/microsoft/callback`
* Firmen-IdP: `{WEB_ORIGIN}/api/auth/sso/company/callback`

Der Firmen-Issuer auf der Kontoseite ist die URL, unter der `/.well-known/openid-configuration` liegt (Entra: `https://login.microsoftonline.com/<Mandanten-ID>/v2.0`). Das ist nicht dasselbe wie die Google-/Microsoft-Buttons, die über die Umgebungsvariablen laufen.

---

# Beispiel: einloggen, dann Fahrzeug anlegen

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "cihan@example.com",
  "password": "development-only-password",
  "remember": true
}
```

```http
POST /api/vehicles
Content-Type: application/json
Cookie: fleet_session=…

{
  "license_plate": "K-XY 123",
  "fuel_level": 85,
  "status": "DRIVING"
}
```

`company_id` im Body wird ignoriert.

---

# API-Design

```text
Routes → Controller → Models → SQLite
```

Controller validieren und mappen HTTP. Models führen SQL aus. Dünn gehalten.

---

# Grenzen

* Cookies sind für same origin gebaut. In Produktion braucht es `CORS_ORIGIN`, Origin-Checks bei Schreibzugriffen und ein Login-Limit. Das Login-Limit gilt auch in der Entwicklung, Tests lassen es aus.
* Abgelaufene Session: `GET /api/auth/me` und spätere `401`. Die UI räumt den Nutzer weg und geht nach `/login`. Falsches Passwort auf `POST /api/auth/login` zählt nicht als Session-Ende.
* Sim-Pause liegt im Speicher. API-Neustart startet alle Firmen wieder.
* Frontend-Tests nur für ein paar riskante Abläufe.
* Logs für Request, SSE, Ticker und Import. Kein Metrik-Stack.

---

# Warum dieses Projekt?

Eine App statt eines Tutorials. REST, relationale Daten, TypeScript, Frontend und Backend getrennt, Karten, SSE, Simulation, Sessions, Mandanten.
