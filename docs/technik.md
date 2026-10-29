# Technik

Zurück zur [README](../README.md). Endpunkte: [api.md](api.md). Lokal starten: [entwicklung.md](entwicklung.md).

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

[Demo-Skript](demo-script.md): 60 bis 90 Sekunden durch Login, Briefing, Dichtekarte, Live-Fahrt, Warnungen und Import.

## Tech-Stack

**Backend:** Node.js, TypeScript, Express 5, SQLite (`node:sqlite`)

**Frontend:** React 19, TypeScript, Vite, React Router, Sass / CSS Modules, Leaflet

**Shared:** `@fleet-live/shared` (snake_case, Zod, Listen, Flotte, SSE, Sim, Auth, Polyline)

**Entwicklung:** npm workspaces, tsx, ESLint, `node:test` + SuperTest, autocannon

## Fahrzeugmodell

Was ein Mensch pflegt: Kennzeichen, VIN, Typ, HU- und UVV-Fälligkeit, Depot, Kostenstelle. Am Fahrer: Telefon, Führerschein gültig bis, letzte Kontrolle. Tankstand, wenn das Fahrzeug nicht fährt. Wer fahren darf und wer es gerade hat, hängt an der Fahrer-API, nicht am Fahrzeugformular. `status` kommt vom Fahrzeug (`DRIVING`, `IDLE`, `STOPPED`, `OFFLINE`) und ist kein Formularfeld. `fuel_level` meldet während `DRIVING` das Fahrzeug (das Formular sperrt das Feld), sonst pflegt man ihn von Hand. Der Simulator meldet den gespeicherten Wert unverändert, in der Demo bleibt der Tank also stehen.

Zusätzlich in der Antwort: Position, Geschwindigkeit, `speed_limit_kmh`, `recorded_at`, `active_alerts`, `speeding_open`, `created_at`.

`company_id` setzt die Session beim Anlegen. Der Client wählt sie nicht.

## Frontend

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
| `/vehicles/import` | Import-Assistent (Datei, Spalten, Vorschau, Ergebnis) |
| `/vehicles/:id` | Detail, Karte, Zuweisung, Warnungen, Bearbeiten, Löschen |
| `/fleet`        | Flottenkarte |
| `/alerts`       | Warnungen (offen/erledigt, optional `type`, `vehicle_id` / `driver_id`) |
| `/fristen`      | Fristen (überfällig, in 30 Tagen, ohne Datum) |
| `/drivers`      | Fahrerliste |
| `/drivers/:id`  | Fahrer, Freigaben, aktuelles Fahrzeug, SPEEDING-Historie |

Ohne Session landet man auf `/login`. Danach ist `/` die Startseite.

### Schichtüberblick

Hinter den Kacheln liegt die Karte der Flotte. Oben die Kennzahlen: offene Warnungen, Kein Signal, fahrend, bereit, niedriger Tank, im Depot. Daneben drei Fristenzahlen, jede öffnet die Liste mit derselben Zahl. „Heute dran“ zeigt, was jetzt zu tun ist (Daten eintragen, Gespräch führen, Fristen bald fällig). Daneben zwei kleine Diagramme; die exakten Monatswerte stehen in einer Tabelle zum Aufklappen. Die Navigation zeigt den Warnungen-Zähler. Fristen steht daneben ohne Zähler. `viewer` liest, `dispatcher` pflegt die Daten.

### Fahrzeugliste

Normale Tabelle. Spalten und Filter sind Konfiguration. Suche, Filter, Sortierung und Seiten laufen auf dem Server. Live-Patches treffen die aktuelle Seite und die Nachbarn.

### Fahrzeugverwaltung

Anlegen, bearbeiten, löschen. Status als Badge. Tank während der Fahrt nur lesen. Der Header pausiert den Simulator dieser Firma und wechselt zwischen Liste und Karte.

### Flottenkarte

`/fleet` lädt die Positionen der eigenen Firma einmal (bis 5000 Einzelpunkte). Jedes Fahrzeug im Ausschnitt ist ein eigener Punkt, das Gruppieren ist vorerst ausgeschaltet. Schwenken lädt nicht neu. Die Leiste zeigt, wie viele Fahrzeuge im Ausschnitt liegen, wie viele der Filter trifft und wie viele keine Position haben. Der Fahrer-Picker ist ein Filter, kein Muss. Über 5000 Treffer mit Position werden Dichtekreise. Übereinanderliegende Fahrzeuge öffnen eine Liste. Ein eindeutiges Kennzeichen holt das Fahrzeug auch von außerhalb. Fahrende Fahrzeuge im Positionsmodus kriegen SSE (bis zu 3000 im Fokus, das gewählte zuerst). Spuren gibt es hier nicht, die liegen auf der Detailseite.

Tabellenkomponente: [apps/docs/table.md](../apps/docs/table.md).

## Telemetrie

Kurzer Puffer: Fahrzeug, Latitude, Longitude, Geschwindigkeit, `recorded_at`. Der letzte Punkt steckt im Fahrzeug-JSON. `GET /api/vehicles/:id/telemetry` gibt `{ data }` chronologisch. Das ist Marker und letzte Bewegung, nicht die Spur.

Der Simulator spielt Geräte: jedes `DRIVING`-Fahrzeug mit Fahrer, dessen Firma die Sim laufen lässt, meldet sich in einem eigenen, leicht schwankenden Takt (`PING_INTERVAL_MS`, Standard 5 s), ob jemand zusieht oder nicht. Der Ticker (`TELEMETRY_TICK_MS`) prüft nur, welche Meldungen fällig sind. `connected` liefert `connection_id`. Die UI schickt `{ connection_id, ids }` (Liste plus Nachbarn, offenes Detail, fahrende auf der Flottenkarte). Jede Verbindung hat eigenen Fokus. Der Fokus bestimmt nur, wer die Patches bekommt, nicht wer fährt. Patches nur an Verbindungen, die die ID fokussiert haben und zur Firma gehören. `vehicles-changed` nur an diese Firma.

Pro Fahrzeug bleiben `TELEMETRY_KEEP_PER_VEHICLE` Rohzeilen (Standard 100). Das ist die Retention. Trip-Ende schreibt Speed 0 an der letzten Position.

Fahrende Fahrzeuge fahren auf eingebackenen OSRM-Linien. Tempo nach Stadt/Autobahn plus etwas Rauschen. Die Simulation läuft im Zeitraffer (Faktor 5), die Fahrzeit einer Fahrt sagt also nichts über echte Zeit.

### Fahrten

Eine Fahrt ist der Datensatz einer Fahrt. Ein Fenster aus Rohpunkten wäre die falsche Einheit. Dann würde die sichtbare Länge von der Tickrate abhängen.

Jede Position kommt an `trips.path` als [kodierte Polyline](https://developers.google.com/maps/documentation/utilities/polylinealgorithm) (Präzision 5).

* Anhängen ist O(1): `path = path || ?`, Vorgänger in `last_latitude` / `last_longitude`. Unter 20 m Abstand fliegt der Punkt raus.
* Beim Schließen vereinfacht Ramer-Douglas-Peucker auf 12 m.
* `distance_m` ist die Summe der gemeldeten Segmente, nicht die vereinfachte Linie.

Zugriff: `trip → vehicle → company`. Kein `company_id` auf `trips`, kein `GET /api/trips/:id`. Die Liste lässt `path` weg. Die Linie kommt mit `GET /api/vehicles/:id/trips/:tripId`.

Abgeschlossene Fahrten werden pro Firma nach ihrer Aufbewahrung gelöscht (Konto → Datenschutz, sonst `TRIP_RETENTION_DAYS`, 90). Offene bleiben. Prune nach Trip-Close und nach Ticks für die Firmen im Batch. `TRIP_RETENTION_DAYS=0` behält Fahrten, solange die Firma nichts einstellt. Erledigte Warnungen (Standard 90 Tage) und das Protokoll (365 Tage) folgen ebenfalls der Firma.

Kompromisse:

* Keine Speed- oder Zeitreihe auf der Polyline. Aggregate liegen an der Fahrt.
* Distanz und Höchstgeschwindigkeit nur bei abgeschlossenen Fahrten, einmal geladen.
* Die Zeile wird bei jedem Append neu geschrieben. Bei mehr Last wäre Chunking der nächste Schritt.

## Warnungen, Hinweise, Verstöße

Drei Schichten, eine Tabelle `alerts`.

* **Indikator.** `speedBand` und `speeding_open`. Orange über `speed_limit_kmh` ohne offenes Event. Rot, solange SPEEDING `ended_at` null hat. Nur bei `DRIVING`. Nach Event-Ende ist die Zelle wieder normal, auch wenn die Inbox-Zeile noch offen ist.
* **Warnung.** `resolved_at IS NULL`. Warnungen `/alerts`. Dispatcher quittiert per `PATCH`. `ended_at` ist nicht dasselbe wie erledigt.
* **Verstoßhistorie.** SPEEDING-Zeilen, auch erledigte, gezählt pro Snapshot-Fahrer auf `/drivers`. Tank und Kein Signal bleiben am Fahrzeug. `resolved_at` heißt gesehen, nicht „war nie“.

`alerts` hängt an `vehicle_id`. Zugriff über `alert → vehicle → company`. `driver_id` wird beim Öffnen aus `vehicles.current_driver_id` kopiert und danach nicht mehr angefasst. `active_alerts` ist der offene Zähler am Fahrzeug und im Listenfilter.

`GET /api/alerts` ist die Inbox. Standard `filter=open`. Optional `type`, `vehicle_id`, `driver_id`. `PATCH` mit `{ resolved: true }` schließt (`dispatcher`). Zweites Schließen ist egal. Viewer lesen. Nach dem Close kommt `vehicles-changed`.

Ticker SPEEDING: 8 s am Stück über dem Sim-Limit (`speedLimitKmh`, Stadt 50 / Autobahn 120). Eine offene Zeile pro Fahrzeug, und eine Zeile je Fahrt: eine spätere Überschreitung derselben Fahrt öffnet die vorhandene, nicht erledigte Zeile wieder (`event_count`, schlimmste Stelle, Summe der Dauer). `details` mit Tempo und Limit an der schlimmsten Stelle (die meisten km/h über dem Limit) und Dauer. 2 s Hysterese oder raus aus `DRIVING` setzt `ended_at`. Jedes achte simulierte Fahrzeug fährt auf einzelnen Abschnitten einer Fahrt zu schnell (8 bis 35 % über dem Limit, jede Fahrt anders). OFFLINE nach 15 s ohne Ticks bei pausierter Sim, oder Status `OFFLINE`; die Zeile schließt sich selbst (`ended_at` und `resolved_at`), sobald das Fahrzeug wieder meldet, kein Erledigen von Hand. Ein beendetes SPEEDING, das niemand erledigt hat, wird nach 7 Tagen erledigt (`resolved_at` = `ended_at` + 7 Tage) und ist dann Verlauf. Erledigte Warnungen werden 90 Tage nach dem Erledigen gelöscht; die Monatssummen für die Schicht-Diagramme stehen vorher in `alert_month_stats`. Niedriger Tank ist Messung, Filter und Warnung: unter 15 % hat das Fahrzeug eine offene LOW_FUEL-Zeile, über 15 % verschwindet sie von selbst (kein Erledigen von Hand). Sie folgt dem Schreiben von `fuel_level` (Fahrzeug anlegen/ändern, Import) und gleicht beim Start alte Zeilen an. Eine offene Zeile pro Fahrzeug und Typ. Anzeige: `formatAlertEvent`. Fahrernamen gehen nach `/drivers/:id`. Klick auf die Warnung öffnet das Fahrzeug.

Live-Speed sitzt in der Telemetrie. Die Polyline hat keinen Speed pro Punkt.

## Fahrer

Eigene Entität, Name eindeutig pro Firma. Freigabe ist `driver_vehicles` (M:N). Aktuell höchstens ein Fahrzeug (`vehicles.current_driver_id`). `NULL` heißt Pool. `driver_name` am Fahrzeug ist der aktuelle Name oder `NULL`.

`POST /api/drivers` legt an (`name`, optional `phone`). `PATCH` ändert Name, Telefon oder die Führerscheindaten. `DELETE` löscht den Fahrer, solange er kein fahrendes Fahrzeug hat; die Warnungen bleiben ohne Namen im Verlauf. Umbenennen schreibt `vehicles.driver_name` mit, wenn der Fahrer aktuell ist. Zuweisen hängt am Fahrer, nicht am Fahrzeug-Write. `GET /api/drivers` sortiert nach offenen SPEEDING-Warnungen und zählt SPEEDING inklusive erledigter. `GET /api/vehicles/drivers` ist nur der Namensfilter auf der Karte.

## Datenbank

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
sites          → company_id   (Depotkreise)
alert_month_stats → company_id, Monat   (Summen, bevor Warnungen gelöscht werden)
trip_month_km  → Kilometer je Firma und Monat
import_runs, import_mapping_profiles → company_id   (Log und Spaltenzuordnung)
auth_tokens, sso_identities, totp_recovery_codes → Anmeldung
```

Partieller Unique-Index `trips(vehicle_id) WHERE ended_at IS NULL`: eine offene Fahrt gleichzeitig.

## Authentifizierung und Mandanten

Da:

* Login, Logout, me
* scrypt
* HttpOnly-Cookie
* Isolation über die aktive Mitgliedschaft (`company_memberships`, Session-Firma)
* `dispatcher` schreibt, pausiert die Sim, erledigt Warnungen, weist Fahrer zu. `viewer` liest.
* SSE und Sim-Pause an diese Firma gebunden

Registrierung, Passwort-Reset, Einladung, mehrere Firmen pro Person, Zwei-Faktor und OIDC sind da. CORS `*` nur lokal. Produktion ohne gesetzten Origin startet nicht und prüft den Origin bei Schreibzugriffen. Produktion braucht `TOTP_ENCRYPTION_KEY`. SMTP über `SMTP_URL`, Absender `MAIL_FROM`, Links über `WEB_ORIGIN`. Google und Microsoft über die jeweiligen Client-Variablen.

## API-Design

```text
Routes → Controller → Models → SQLite
```

Controller validieren und mappen HTTP. Models führen SQL aus. Dünn gehalten.

## Grenzen

* Cookies sind für same origin gebaut. In Produktion braucht es `CORS_ORIGIN`, Origin-Checks bei Schreibzugriffen und ein Login-Limit. Das IP-Limit gilt auch in der Entwicklung, Tests lassen es aus. Falsche Passwörter je Adresse sperren nicht, sie verlängern die Wartezeit bis zum nächsten Versuch (höchstens eine Minute).
* Abgelaufene Session: `GET /api/auth/me` und spätere `401`. Die UI räumt den Nutzer weg und geht nach `/login`. Falsches Passwort auf `POST /api/auth/login` zählt nicht als Session-Ende.
* Sim-Pause liegt im Speicher. API-Neustart startet alle Firmen wieder.
* Frontend-Tests (Vitest) decken Seiten, Bausteine und die Kartenlogik ab; Leaflet selbst läuft nicht in jsdom und wird im Browser geprüft. Es gibt keine CI auf GitHub, `npm run verify` läuft lokal.
* Logs für Request, SSE, Ticker und Import. Kein Metrik-Stack.
