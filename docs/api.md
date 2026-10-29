# API

Zurück zur [README](../README.md).

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
| `POST` | `/api/auth/logout-all` | Beendet alle Sessions der Person |
| `POST` | `/api/auth/password` | Passwort ändern |
| `GET`  | `/api/auth/me` | Aktueller Nutzer inklusive `company_name`, `memberships`, `invitations` (Zahl offener Einladungen) oder `401` |
| `POST` | `/api/auth/company` | Aktive Firma wechseln |
| `POST` | `/api/auth/companies` | Weitere Firma anlegen und dorthin wechseln |
| `POST` | `/api/auth/invites` | Dispatcher lädt `{ email, role }` ein. Daraus wird erst eine Mitgliedschaft, wenn die Person annimmt; eine zweite Einladung an dieselbe Person ist `409` |
| `DELETE` | `/api/auth/invites/:userId` | Offene Einladung zurückziehen (Dispatcher); ihr Mail-Link gilt dann nicht mehr |
| `POST` | `/api/auth/invites/accept` | Link aus der Mail für ein neues Konto: Name und Passwort setzen, Einladung annehmen |
| `GET` | `/api/auth/invitations` | Offene Einladungen der angemeldeten Person |
| `POST`, `DELETE` | `/api/auth/invitations/:companyId/accept`, `/api/auth/invitations/:companyId` | Einladung annehmen oder ablehnen |
| `GET`, `PATCH`, `DELETE` | `/api/auth/members`, `/api/auth/members/:userId` | Team der Firma lesen (offene Einladungen mit `invited: true`), Rolle ändern, entfernen (Dispatcher). Eine Firma behält mindestens einen Dispatcher |
| `GET`, `PATCH` | `/api/auth/security` | Firmen-Login (OIDC) lesen und setzen (Dispatcher) |
| `POST` | `/api/auth/totp/setup`, `/totp/confirm`, `/totp/disable` | Zwei-Faktor einrichten, bestätigen, ausschalten |
| `POST` | `/api/auth/import-prompt/dismiss` | Die einmalige Frage nach dem Import schließen |
| `GET`  | `/api/auth/sso/providers` | `{ google, microsoft }` — nur `true`, wenn Client-ID und Secret gesetzt sind |
| `GET`  | `/api/auth/sso/google/start` | Weiterleitung zu Google. Microsoft (`/sso/microsoft/start`) analog; die Rückkehr ist `/sso/:provider/callback` |
| `POST`, `GET` | `/api/auth/sso/company/discover`, `/sso/company/start`, `/sso/company/callback` | Firmen-IdP: Firma finden, Weiterleitung, Rückkehr |
| `POST` | `/api/auth/sso/link` | `{ provider, company_id?, challenge? }` → `{ url }`. Verknüpft einen externen Login mit dem angemeldeten Konto, oder mit `challenge` (aus `SSO_REQUIRED`) den Firmen-Login nach Passwort und zweitem Faktor |

`remember: true` hält das Cookie sieben Tage. Sonst ist es ein Sitzungs-Cookie, und 15 Minuten ohne Nutzung beenden die Sitzung. Falsches Passwort ist `401`, ohne zu sagen welches Feld. Passwort mindestens 12 und höchstens 128 Zeichen. Ohne `SMTP_URL` schreibt die Entwicklung den Reset-Link ins Server-Log und sagt das in der Antwort; es geht keine Mail raus. Produktion ohne SMTP antwortet `503`. Die Anmeldeseite zeigt Google und Microsoft nur, wenn die jeweiligen Client-Variablen gesetzt sind.

Ein externer Login meldet nur an, wenn ihn der Inhaber verknüpft hat (Issuer und Subject des Tokens; eine gleiche E-Mail allein genügt nie). Verlangt die Firma ihren eigenen Login, verknüpft die Anmeldeseite ihn nach Passwort und zweitem Faktor einmalig. Verlangen Konto oder Firma einen zweiten Faktor, fragt die Anmeldung auch nach Google, Microsoft oder dem Firmen-Login danach. Eine Sitzung aus dem Firmen-Login gilt nur in dieser Firma. Ändert eine Firma diese Regeln, enden die Sitzungen und Live-Verbindungen, die sie nicht erfüllen. Sicherheitsmodell, offene Punkte und Betriebsanforderungen: [`SECURITY.md`](../SECURITY.md), [`docs/security-remediation-plan.md`](security-remediation-plan.md).

## Fahrzeuge und Livedaten

| Methode  | Endpoint                         | Beschreibung |
| -------- | -------------------------------- | ------------ |
| `GET`    | `/api/vehicles`                  | Liste (`search`, `filter`, `sort`, `dir`, `page`, `limit`) |
| `GET`    | `/api/vehicles/positions`        | Letzte Positionen für die Karte (`bbox`, `filter`, `drivers` oder `driver_search`). `search` wird angenommen und blendet nichts aus |
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
| `GET`    | `/api/sim/routes`                | Die Simulator-Straßen als kodierte Polylinien für die Karten |
| `PATCH`  | `/api/sim`                       | `{ running }`, Sim dieser Firma pausieren oder fortsetzen |
| `GET`    | `/api/alerts`                    | Warnungen (`filter` open/resolved/all, optional `type`, `vehicle_id`, `driver_id`, `page`, `limit`) |
| `PATCH`  | `/api/alerts/:id`                | `{ resolved: true }`, nur `dispatcher` |
| `PATCH`  | `/api/alerts`                    | `{ ids, resolved: true }`, mehrere auf einmal, nur `dispatcher`. Eine fremde ID ist `404` und nichts ändert sich |
| `GET`    | `/api/briefing`                  | Snapshot für die Startseite |
| `GET`    | `/api/today`                     | Die Liste „Heute dran“ der Schicht (`limit` 1 bis 50, Standard 12) |
| `GET`    | `/api/due`                       | Fristen seitenweise (`state`, optional `kind`, `search`) |
| `GET`, `PATCH` | `/api/due/settings`        | Vorlauf in Tagen und Kontrollabstand in Monaten. Lesen auch als Viewer, schreiben nur `dispatcher` |
| `GET`    | `/api/sites`                     | Depots der Firma mit Zahlen |
| `POST`, `PATCH`, `DELETE` | `/api/sites`, `/api/sites/:id` | Depotkreise pflegen, `dispatcher` |
| `GET`    | `/api/drivers`                   | Fahrer (`search`, `page`, `limit`, optional `vehicle_id`, `min_open_warnings`, `without_vehicle=true`). Sortierung: offene Warnungen |
| `POST`   | `/api/drivers`                   | `{ name, phone?, licence_expires_on?, licence_checked_on? }`, `dispatcher` |
| `GET`    | `/api/drivers/:id`               | Fahrer, Freigaben, aktuelles Fahrzeug. `404` wenn weg oder andere Firma |
| `PATCH`  | `/api/drivers/:id`               | `{ name?, phone?, licence_expires_on?, licence_checked_on? }`, `dispatcher` |
| `DELETE` | `/api/drivers/:id`               | `204`, oder `409`, solange der Fahrer ein fahrendes Fahrzeug hat, `dispatcher` |
| `POST`   | `/api/drivers/:id/vehicles`      | `{ vehicle_id }`, Freigabe, `dispatcher` |
| `DELETE` | `/api/drivers/:id/vehicles/:vehicleId` | Freigabe weg, `dispatcher` |
| `PATCH`  | `/api/drivers/:id/current-vehicle` | `{ vehicle_id }` oder `{ vehicle_id: null }`, `dispatcher` |
| `POST`   | `/api/import/preview`            | `csv` oder `xlsx` (Base64) prüfen, `dispatcher` |
| `GET` | `/api/import/preview/:previewId/rows` | Zeilen der Vorschau lesen |
| `PATCH`, `POST` | `/api/import/preview/:previewId/actions`, `/mark-existing` | Aktionen je Zeile ändern, Zeilen als „schon da“ markieren |
| `POST`   | `/api/import/commit`             | Alles in einer Transaktion schreiben, schreibt das Log und optional das Firmenprofil |
| `GET`, `PUT` | `/api/import/profile`        | Gespeicherte Spaltenzuordnung der Firma |
| `GET`    | `/api/import/runs`               | Import-Log der Firma |
| `GET`    | `/api/export/vehicles`, `/alerts`, `/trips`, `/period` | CSV der Firma (Semikolon, deutsche Köpfe), nur `dispatcher`. `/period?month=JJJJ-MM` ist ein Monat |
| `GET`    | `/api/health`                    | `{ status: "ok" }` |

`GET /api/vehicles` gibt `{ data, meta }`. In `meta`: `total`, `pageCount`, Facetten `counts` (`all`, `alerts`, `low_fuel`, `unassigned`, `driving`, `idle`, `stopped`, `offline`, `in_depot`, `speeding`).

`GET /api/alerts` gibt Warnungen mit Kennzeichen und dem Fahrer zum Zeitpunkt des Öffnens (`driver_id` / `driver_name`). Dazu `ended_at` und `details` (SPEEDING: `{ limit_kmh, max_speed_kmh, duration_s, event_count }`). Standardfilter `open` heißt `resolved_at IS NULL`. `ended_at` spielt dafür keine Rolle. `type` optional: `SPEEDING`, `LOW_FUEL`, `OFFLINE`. `meta.counts` ist `open` / `resolved` / `all` und ignoriert `type`. `meta.type_counts` hängt am Filter. `vehicle_id` oder `driver_id` optional, sonst 404 wenn fremd. Umbesetzung ändert alte Zeilen nicht.

`GET /api/drivers` listet Fahrer der Session-Firma. `counts` und `open_warnings` zählen nur SPEEDING (über den Snapshot `alerts.driver_id`). `vehicle_plate` nur wenn genau ein freigegebenes Fahrzeug. `current_vehicle_plate` ist das Fahrzeug mit `current_driver_id`. Mit `vehicle_id` kommen die Fahrer, die für dieses Fahrzeug frei sind. `min_open_warnings` lässt nur Fahrer mit mindestens so vielen offenen SPEEDING-Warnungen durch, `without_vehicle=true` nur Fahrer ohne aktuelles Fahrzeug; `meta.total` zählt nach Filter. `last_warning_at` ist die neueste offene SPEEDING-Warnung. `GET /api/drivers/:id` hängt `vehicles` (`is_current`) und `current_vehicle` an.

`GET /api/briefing` gibt Statuszähler (`driving`, `idle`, `offline`), Inbox `open`, `low_fuel`, `in_depot`, monatliche `history` und `due` als Zähler (überfällig, in 30 Tagen, fehlende Felder). `GET /api/due` gibt dieselben Fristen seitenweise (`state`, optional `kind`, `search`). `viewer` darf lesen.

`GET /api/vehicles/positions` ist entweder `positions` oder `density`, plus `meta.total`, `meta.matched` und `meta.without_position`. `matched` zählt die Filtertreffer der Firma ohne Kartenausschnitt, inklusive Fahrzeuge ohne Position. Jede Zeile hat `has_position`. Ohne Telemetrie sind Koordinaten null; `without_position` ignoriert den Kartenausschnitt. `bbox=west,south,east,north` optional und gilt nur für Zeilen mit Position. `search` schränkt die Zeilen nicht ein. Kennzeichen und aktueller Fahrer werden in dem geladenen Bestand gesucht. `drivers` filtert die Ansicht. Bis `FLEET_POSITIONS_MAX` (5000) kommen Einzelpositionen. Die Karte lädt diesen Bestand einmal. Darüber höchstens 32 mal 20 Dichtezellen.

Query-Parameter stehen in `@fleet-live/shared`. Kaputte Sortierung oder Limits: `400`. Seitengröße 1 bis 100 (Standard 10); die Listen fragen so viele Zeilen an, wie in ihre Höhe passen. Kennzeichen max. 32 Zeichen, Fahrername max. 80. Beides eindeutig pro Firma.

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

Fahrzeug-JSON: letzte Telemetrie oder `null`, `speed_limit_kmh`, `active_alerts`, `speeding_open`, `current_driver_id`, `driver_name` (null im Pool), Hof-Felder `vin`, `vehicle_type`, `hu_due_on`, `uvv_due_on`, `depot`, `cost_center`. Anlegen und Update nehmen Kennzeichen, Tank, Status und Hof-Felder. Keinen Fahrernamen. Zuweisung läuft über `/api/drivers`. Fahrer tragen `licence_expires_on` und `licence_checked_on`.

## Beispiel: einloggen, dann Fahrzeug anlegen

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
  "status": "IDLE"
}
```

`company_id` im Body wird ignoriert. Ein Fahrzeug fährt nur mit Fahrer: `status: "DRIVING"` ohne aktuellen Fahrer antwortet `409` mit `fields.status`. Erst `POST /api/drivers/:id/vehicles`, dann `PATCH /api/drivers/:id/current-vehicle`, dann auf `DRIVING` setzen.
