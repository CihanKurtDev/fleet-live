# API

Zurück zur [README](../README.md).

Fahrzeug, Stream und Sim brauchen eine Session. `GET /api/health` nicht. `error` und `fields` auf Deutsch, `code` auf Englisch.

## Auth

| Methode | Endpoint | Beschreibung |
| ------- | -------- | ------------ |
| `POST` | `/api/auth/register` | Firma plus erster Dispatcher. Keine Session, bis die E-Mail bestätigt ist. Eine schon registrierte E-Mail bekommt dieselbe Antwort; der Inhaber erhält eine Hinweis-Mail (unbestätigt: den Bestätigungslink neu), es entsteht keine Firma |
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
| `GET`, `PATCH` | `/api/auth/privacy` | Datenschutz der Firma (Dispatcher): `viewer_driver_names` (ob Viewer sehen, wer gefahren ist) und die Aufbewahrung `trips_days`, `alerts_days`, `audit_days` in Tagen oder `null` für den Standard. `PATCH` löscht sofort, was älter ist, und nennt die Zahl in `deleted` |
| `GET` | `/api/auth/audit` | Protokoll der Firma: Einladungen, Rollen, Entfernen, Anmelde-Regeln, Verknüpfung mit dem Firmen-Login; neueste zuerst, 50 je Seite (`page`), nur Dispatcher |
| `POST` | `/api/auth/totp/setup`, `/totp/confirm`, `/totp/disable` | Zwei-Faktor einrichten, bestätigen, ausschalten |
| `POST` | `/api/auth/import-prompt/dismiss` | Die einmalige Frage nach dem Import schließen |
| `GET`  | `/api/auth/sso/providers` | `{ google, microsoft }` — nur `true`, wenn Client-ID und Secret gesetzt sind |
| `GET`  | `/api/auth/sso/google/start` | Weiterleitung zu Google. Microsoft (`/sso/microsoft/start`) analog; die Rückkehr ist `/sso/:provider/callback` |
| `POST`, `GET` | `/api/auth/sso/company/discover`, `/sso/company/start`, `/sso/company/callback` | Firmen-IdP: Firma finden (über die bestätigte Domain der E-Mail, nie über Mitgliedschaften), Weiterleitung, Rückkehr |
| `GET`, `POST`, `DELETE` | `/api/auth/domains`, `/api/auth/domains/:id/verify`, `/api/auth/domains/:id` | Domains der Firma (Dispatcher): eintragen, per DNS-TXT-Eintrag `_fleet-live.<domain>` bestätigen, entfernen. Eine Domain kann nur eine Firma bestätigen (`409`) |
| `POST` | `/api/auth/sso/link` | `{ provider, company_id?, challenge? }` → `{ url }`. Verknüpft einen externen Login mit dem angemeldeten Konto, oder mit `challenge` (aus `SSO_REQUIRED`) den Firmen-Login nach Passwort und zweitem Faktor. Zurück geht es auf `/konto?sso=…#anmeldung` (Google, Microsoft) bzw. `#firmen-login` |
| `DELETE` | `/api/auth/sso/links/:provider` | Eigene Verknüpfung mit `google` oder `microsoft` trennen; der Firmen-Login lässt sich so nicht trennen. `GET /me` zeigt den Stand in `sso_links` |

`remember: true` hält das Cookie sieben Tage. Sonst ist es ein Sitzungs-Cookie, und 15 Minuten ohne Nutzung beenden die Sitzung. Falsches Passwort ist `401`, ohne zu sagen welches Feld. Ab dem sechsten falschen Versuch für eine Adresse muss der nächste Versuch warten (2, 4, 8 … höchstens 60 Sekunden); vorher kommt `429` `LOGIN_SLOW_DOWN` mit `Retry-After`. Danach geht das richtige Passwort wieder, und es setzt die Zählung zurück. Passwort mindestens 12 und höchstens 128 Zeichen. Ohne `SMTP_URL` schreibt die Entwicklung den Reset-Link ins Server-Log und sagt das in der Antwort; es geht keine Mail raus. Produktion ohne SMTP antwortet `503`. Die Anmeldeseite zeigt Google und Microsoft nur, wenn die jeweiligen Client-Variablen gesetzt sind.

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
| `GET`    | `/api/vehicles/:id/workshop`     | Offener Werkstatt-Aufenthalt mit Verlauf, frühere Aufenthalte (höchstens 20), die Werkstatt, in deren Kreis das Fahrzeug steht (`here`), und ein fertiger Aufenthalt, der noch abgeholt werden muss (`to_pick_up`). Auch als Viewer |
| `POST`   | `/api/vehicles/:id/workshop`     | `{ reasons, transport, workshop_id, planned_on, planned_time?, expected_on, bring_driver_id?, assignee_user_id, note?, arrived?, damage_ids? }`, `dispatcher`. `reasons` ist eine Liste (`HU`, `UVV`, `MAINTENANCE`, `DAMAGE`, `OTHER`), ein Aufenthalt erledigt alles darin. `transport`: `DRIVER` (ein freigegebener Fahrer mit gültigem Führerschein bringt es, `bring_driver_id`), `TOW` oder `WORKSHOP_PICKUP`; nicht fahrbereit geht nur ohne Fahrer. Termin frühestens heute; `DAMAGE` braucht `damage_ids`; `arrived` nur, wenn das Fahrzeug schon im Kreis dieser Werkstatt parkt (sonst `409` `NOT_AT_WORKSHOP`). `409` bei schon offenem Aufenthalt |
| `GET`    | `/api/vehicles/:id/workshop/bringers` | Wer das Fahrzeug an einem Tag (`on`) hinbringen kann: freigegebene Fahrer mit Hinweis, ob sie gerade fahren, schon etwas hinbringen oder einen abgelaufenen Führerschein haben. `dispatcher` |
| `PATCH`  | `/api/vehicles/:id/availability` | `{ out_of_service }`, `dispatcher`. `409` in der Werkstatt oder auf Fahrt |
| `PATCH`  | `/api/workshop/:visitId`         | Offenen Aufenthalt ändern (Termin, Werkstatt, Transport und „Bringt hin“ nur vor der Ankunft, Gründe und `damage_ids` auch in der Werkstatt; ein neuer Termin liegt heute oder später), `dispatcher` |
| `POST`   | `/api/workshop/:visitId/arrive`  | Ankunft von Hand (ohne Signal); `409` auf Fahrt. Sonst erkennt der Server die Ankunft an der Position. Der aktuelle Fahrer wird frei, `dispatcher` |
| `POST`   | `/api/workshop/:visitId/finish`  | `{ finished_on, cost?, result_note?, hu_due_on?, odometer? }` (HU: `hu_due_on` Pflicht; `odometer` = Kilometerstand laut Rechnung, nur ohne Tachostand vom Gerät), `dispatcher` |
| `POST`   | `/api/workshop/:visitId/cost`    | `{ cost }` trägt die Kosten eines fertigen Aufenthalts nach, `dispatcher` |
| `POST`   | `/api/workshop/:visitId/cancel`  | Geplanten Aufenthalt absagen, `dispatcher` |
| `GET`    | `/api/workshop/places`           | Werkstätten der Firma (Name, Adresse, Telefon, Kreis, `vehicles_here`, die Fahrzeuge dort in `here` und die offenen Termine in `appointments`, je höchstens 8). Auch als Viewer |
| `GET`    | `/api/workshop/geocode/config`   | `{ enabled }`: ob die Adresssuche eingerichtet ist (`GEOCODER_URL`) |
| `GET`    | `/api/workshop/geocode?q=`       | Adresse suchen (3–200 Zeichen), bis zu 5 Treffer `{ label, latitude, longitude }`, `dispatcher`. Nur auf Knopfdruck, nie beim Tippen; der Server fragt höchstens einmal je Sekunde und merkt sich Antworten einen Tag. Ohne Einrichtung `503` `GEOCODER_OFF`, Dienst nicht erreichbar `502` |
| `POST`, `PATCH`, `DELETE` | `/api/workshop/places`, `/api/workshop/places/:placeId` | Werkstatt anlegen, ändern, löschen (`{ name, address?, phone?, latitude, longitude, radius_m }`), `dispatcher`. Löschen ist `409` `WORKSHOP_IN_USE`, solange ein offener Aufenthalt sie nutzt |
| `GET`    | `/api/vehicles/:id/damages`      | Schäden des Fahrzeugs, offene zuerst (höchstens 50). Auch als Viewer |
| `POST`   | `/api/vehicles/:id/damages`      | `{ occurred_on, description, severity, drivable, occurred_time?, latitude?, longitude? }`, `dispatcher`. Merkt sich den aktuellen Fahrer (`driver_id`, `driver_name`). Nicht fahrbereit nimmt den Fahrer vom Fahrzeug; auf Fahrt (Panne) hält es an und die Fahrt endet |
| `PATCH`  | `/api/damages/:damageId`         | Offenen Schaden ändern (dieselben Felder), `dispatcher` |
| `POST`   | `/api/damages/:damageId/photos`  | Ein Foto als Body (`Content-Type` `image/jpeg`, `image/png` oder `image/webp`, höchstens 1,5 MB, die Bytes müssen zum Typ passen), höchstens 3 je Schaden (`409` `DAMAGE_PHOTOS_FULL`), `dispatcher` |
| `GET`    | `/api/damages/:damageId/photos/:photoId` | Das Foto (privat zwischengespeichert, `nosniff`). Auch als Viewer, andere Firma `404` |
| `DELETE` | `/api/damages/:damageId/photos/:photoId` | Foto eines offenen Schadens entfernen, `dispatcher` |
| `POST`   | `/api/damages/:damageId/close`   | Ohne Werkstatt erledigen (nicht, solange ein offener Aufenthalt ihn hat), `dispatcher` |
| `GET`    | `/api/vehicles/:id/odometer`     | Kilometerstand `{ km, reported_at, readings }`: `reported_at` ist gesetzt, wenn das Gerät den Tacho meldet; `readings` jeder eingetragene, importierte oder korrigierte Stand, neueste zuerst (höchstens 20). Auch als Viewer |
| `POST`   | `/api/vehicles/:id/odometer`     | `{ km, note? }` setzt den Stand einer GPS-Box (ganze km, 0–2.000.000), `dispatcher`. Derselbe Stand ist `400`, ein Tachostand vom Gerät `409` `ODOMETER_FROM_DEVICE` |
| `POST`   | `/api/vehicles`                  | Anlegen, `Location` bei `201`. `company_id` aus der Session |
| `PUT`    | `/api/vehicles/:id`              | Ersetzen |
| `PATCH`  | `/api/vehicles/:id`              | Aktualisieren |
| `DELETE` | `/api/vehicles/:id`              | Löschen |
| `GET`    | `/api/stream`                    | SSE: `connected` (`connection_id`), Telemetrie, `vehicles-changed` |
| `POST`   | `/api/stream/focus`              | `{ connection_id, ids }`. Nur Fahrzeuge dieser Firma, Verbindung muss dazugehören |
| `GET`    | `/api/sim`                       | `{ running, available, time_scale }` für diese Firma; `time_scale` sagt, wie viel schneller als die Uhr die Demo fährt |
| `GET`    | `/api/sim/routes`                | Die Simulator-Straßen als kodierte Polylinien für die Karten |
| `PATCH`  | `/api/sim`                       | `{ running }`, Sim dieser Firma pausieren oder fortsetzen |
| `GET`    | `/api/alerts`                    | Warnungen (`filter` open/resolved/all, optional `type`, `vehicle_id`, `driver_id`, `page`, `limit`) |
| `PATCH`  | `/api/alerts/:id`                | `{ resolved: true }`, nur `dispatcher` |
| `PATCH`  | `/api/alerts`                    | `{ ids, resolved: true }`, mehrere auf einmal, nur `dispatcher`. Eine fremde ID ist `404` und nichts ändert sich |
| `GET`    | `/api/briefing`                  | Snapshot für die Startseite |
| `GET`    | `/api/today`                     | Die Liste „Heute dran“ der Schicht (`limit` 1 bis 50, Standard 12) |
| `GET`    | `/api/due`                       | Fristen seitenweise (`state`, optional `kind`, `search`) |
| `GET`, `PATCH` | `/api/due/settings`        | Vorlauf in Tagen und Kontrollabstand in Monaten. Lesen auch als Viewer, schreiben nur `dispatcher` |
| `GET`    | `/api/sites`                     | Depots der Firma mit Zahlen; `home_status` teilt die Fahrzeuge mit diesem Stammstandort nach Status auf |
| `POST`, `PATCH`, `DELETE` | `/api/sites`, `/api/sites/:id` | Depotkreise pflegen, `dispatcher` |
| `GET`    | `/api/drivers`                   | Fahrer (`search`, `page`, `limit`, optional `vehicle_id`, `min_open_warnings`, `without_vehicle=true`, `licence_driving=true`). Sortierung: offene Warnungen |
| `POST`   | `/api/drivers`                   | `{ name, phone?, licence_expires_on?, licence_checked_on? }`, `dispatcher` |
| `GET`    | `/api/drivers/:id`               | Fahrer, Freigaben, aktuelles Fahrzeug. `404` wenn weg oder andere Firma |
| `PATCH`  | `/api/drivers/:id`               | `{ name?, phone?, licence_expires_on?, licence_checked_on? }`, `dispatcher`. Eine Kontrolle nach dem Ablaufdatum ohne neues Ablaufdatum ist `400` |
| `POST`   | `/api/drivers/:id/talk`          | `{ note? }` (höchstens 500 Zeichen): „Gespräch geführt“ erledigt alle offenen Tempo-Warnungen des Fahrers mit dem Vermerk in `resolution_note`; Antwort `{ resolved }`, `dispatcher` |
| `DELETE` | `/api/drivers/:id`               | `204`, oder `409`, solange der Fahrer ein fahrendes Fahrzeug hat, `dispatcher` |
| `POST`   | `/api/drivers/:id/vehicles`      | `{ vehicle_id }`, Freigabe, `dispatcher` |
| `DELETE` | `/api/drivers/:id/vehicles/:vehicleId` | Freigabe weg, `dispatcher` |
| `PATCH`  | `/api/drivers/:id/current-vehicle` | `{ vehicle_id }` oder `{ vehicle_id: null }`, `dispatcher`. Abgelaufener Führerschein `409` `LICENCE_EXPIRED`, Fahrzeug nicht verfügbar `409` `VEHICLE_UNAVAILABLE` |
| `POST`   | `/api/import/preview`            | `csv` oder `xlsx` (Base64) prüfen, `dispatcher` |
| `GET` | `/api/import/preview/:previewId/rows` | Zeilen der Vorschau lesen |
| `PATCH`, `POST` | `/api/import/preview/:previewId/actions`, `/mark-existing` | Aktionen je Zeile ändern, Zeilen als „schon da“ markieren |
| `POST`   | `/api/import/commit`             | Alles in einer Transaktion schreiben, schreibt das Log und optional das Firmenprofil |
| `GET`, `PUT` | `/api/import/profile`        | Gespeicherte Spaltenzuordnung der Firma |
| `GET`    | `/api/import/runs`               | Import-Log der Firma |
| `GET`    | `/api/export/vehicles`, `/alerts`, `/trips`, `/period` | CSV der Firma (Semikolon, deutsche Köpfe), nur `dispatcher`. `/period?month=JJJJ-MM` ist ein Monat. Die Spalte „Verbrauch l (geschätzt)“ rechnet pauschal 25 l je 100 km, für jeden Fahrzeugtyp gleich |
| `GET` | `/api/export/drivers/:id` | Auskunft über einen Fahrer als ZIP (Dispatcher): Stammdaten, Fahrzeuge, Fahrten, Strecken als GeoJSON, Ereignisse, Warnungen, Werkstatt-Aufenthalte, die er hinbringen sollte, und ein Liesmich. Steht im Protokoll |
| `GET`    | `/api/health`                    | `{ status: "ok" }` |

`GET /api/vehicles` gibt `{ data, meta }`. In `meta`: `total`, `pageCount`, Facetten `counts` (`all` und je Filter: `alerts`, `low_fuel`, `unassigned`, `driving`, `idle`, `stopped`, `offline`, `in_depot`, `speeding`, `in_workshop`, `workshop_due`, `out_of_service`, `damage_open`, `not_drivable`, `damage_unplanned`, `unavailable` (Werkstatt, nicht fahrbereit oder außer Dienst), `deadline_overdue` (HU oder UVV abgelaufen), `deadline_soon` (im Vorlauf der Firma fällig, keine abgelaufen)). Die Fristen-Filter nutzen dieselbe Regel wie `/api/due`; jedes Fahrzeug trägt sie als `hu_state` und `uvv_state` (`overdue`, `soon`, `ok`, `missing`). Jedes Fahrzeug trägt `availability` (`READY`, `WORKSHOP`, `NOT_DRIVABLE`, `OUT_OF_SERVICE`), `workshop` (offener Aufenthalt oder `null`), `workshop_task` (was ein Aufenthalt heute braucht: `missed`, `return_late`, `trip_no_driver`, `pickup`, `unplanned`, sonst `null`; dieselbe Bedingung wie der Filter `workshop_due`) und `open_damages`. Die Ankunft erkennt der Server an der Position: ein geplanter Aufenthalt, dessen Fahrzeug im Kreis seiner Werkstatt parkt, ist `IN_WORKSHOP` (`arrived_by: "POSITION"`); verlässt ein fertiges Fahrzeug den Kreis, ist es abgeholt (`picked_up_at`). `POST /api/vehicles/:id/workshop` nimmt `damage_ids` (offene Schäden des Fahrzeugs); Fertig setzt sie auf `REPAIRED`, Absagen gibt sie frei.

`GET /api/alerts` gibt Warnungen mit Kennzeichen und dem Fahrer zum Zeitpunkt des Öffnens (`driver_id` / `driver_name`). Dazu `ended_at` und `details` (SPEEDING: `{ limit_kmh, max_speed_kmh, duration_s, event_count }`). Standardfilter `open` heißt `resolved_at IS NULL`. `ended_at` spielt dafür keine Rolle. `type` optional: `SPEEDING`, `LOW_FUEL`, `OFFLINE`. `meta.counts` ist `open` / `resolved` / `all` und ignoriert `type`. `meta.type_counts` hängt am Filter. `meta.resolved_kept_days` sagt, wie lange eine erledigte Warnung bleibt (Einstellung der Firma, sonst 90 Tage). `vehicle_id` oder `driver_id` optional, sonst 404 wenn fremd. Umbesetzung ändert alte Zeilen nicht. `trip_id` nennt die Fahrt, auf der die Warnung entstand (aus den Fahrt-Ereignissen, sonst `null`); `resolution_note` sagt, wie sie erledigt wurde („Gespräch geführt am …“). Eine Tempo-Warnung entsteht erst ab 10 km/h über dem Limit.

`GET /api/drivers` listet Fahrer der Session-Firma. `counts` und `open_warnings` zählen nur SPEEDING (über den Snapshot `alerts.driver_id`). `vehicle_plate` nur wenn genau ein freigegebenes Fahrzeug. `current_vehicle_plate` ist das Fahrzeug mit `current_driver_id`. Mit `vehicle_id` kommen die Fahrer, die für dieses Fahrzeug frei sind. `min_open_warnings` lässt nur Fahrer mit mindestens so vielen offenen SPEEDING-Warnungen durch, `without_vehicle=true` nur Fahrer ohne aktuelles Fahrzeug, `licence_driving=true` nur Fahrer mit abgelaufenem Führerschein und aktuellem Fahrzeug; `meta.total` zählt nach Filter. `last_warning_at` ist die neueste offene SPEEDING-Warnung. `GET /api/drivers/:id` hängt `vehicles` (`is_current`), `current_vehicle` und `workshop_transports` (offene Aufenthalte, die er hinbringen soll) an.

`GET /api/briefing` gibt Statuszähler (`driving`, `idle`, `offline`), Inbox `open`, `low_fuel`, `in_depot`, `unavailable`, monatliche `history` (aktive Fahrer und Fahrzeuge eines Monats aus seinen Fahrten, `null`, wenn die Fahrten schon gelöscht sind; Wenig Tank und Kein Signal zählen Fahrzeuge, die im Monat eine solche Warnung hatten) und `due` als Zähler (überfällig, in 30 Tagen, fehlende Felder). `GET /api/due` gibt dieselben Fristen seitenweise (`state`, optional `kind`, `search`); HU- und UVV-Zeilen tragen den offenen Werkstatt-Aufenthalt des Fahrzeugs (`workshop`). `GET /api/today` hat die Art `workshop_due` mit `workshop_task` je Zeile: Termin verpasst, Rückgabe überfällig, Hinfahrt heute ohne Fahrer, fertig und ohne Fahrer zum Abholen, oder parkt bei einer Werkstatt ohne Aufenthalt (`workshop_place`); dem Anfragenden zugewiesene zuerst. Ihre Zahl ist die des Filters `workshop_due`. Die Art `damage_unplanned` sind nicht fahrbereite Fahrzeuge ohne offenen Aufenthalt (Filter `damage_unplanned`), je Fahrzeug der älteste solche Schaden. `viewer` darf lesen.

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

Fahrzeug-JSON: letzte Telemetrie oder `null`, `speed_limit_kmh`, `active_alerts`, `speeding_open`, `current_driver_id`, `driver_name` (null im Pool), Hof-Felder `vin`, `vehicle_type`, `hu_due_on`, `uvv_due_on`, `depot`, `cost_center`, `odometer_km` (ganze km, `null` ohne Stand) und `odometer_reported_at` (gesetzt, wenn das Gerät den Tacho meldet, wie ein LKW über FMS; sonst wächst der Stand mit jeder gemeldeten Strecke). Die Telemetrie im Stream trägt `odometer_km` und bei einem Tachostand `odometer_from_device`. Anlegen und Update nehmen Kennzeichen, Tank, Status und Hof-Felder; `odometer_km` nur das Anlegen, danach ändert ihn `POST /api/vehicles/:id/odometer` (ein Update damit ist `400`). Keinen Fahrernamen. Zuweisung läuft über `/api/drivers`. Fahrer tragen `licence_expires_on` und `licence_checked_on`.

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
