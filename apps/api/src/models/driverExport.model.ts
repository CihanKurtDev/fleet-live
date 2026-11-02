import { strToU8, zipSync } from "fflate";
import {
    DAMAGE_SEVERITY_LABELS,
    DAMAGE_STATE_LABELS,
    RETENTION_FALLBACK,
    WORKSHOP_TRANSPORT_LABELS,
    parseWorkshopReasons,
    workshopReasonsText,
    WORKSHOP_STATE_LABELS,
    decodePolyline,
    formatAlertEvent,
    type AlertSeverity,
    type AlertType,
    type DamageSeverity,
    type DamageState,
    type WorkshopTransport,
    type WorkshopState,
} from "@fleet-live/shared";
import { stmt } from "../db/statements";
import { toCsv } from "../lib/csv";
import {
    ALERT_SEVERITY_LABELS,
    ALERT_TYPE_LABELS,
    formatKm,
    formatStamp,
    parseDetails,
} from "./export.model";
import { PrivacyModel } from "./privacy.model";

type DriverRow = {
    id: number;
    name: string;
    phone: string | null;
    licence_expires_on: string | null;
    licence_checked_on: string | null;
    created_at: string;
    company_name: string;
};

type TripRow = {
    id: number;
    license_plate: string;
    started_at: string;
    ended_at: string | null;
    distance_m: number | null;
    max_speed: number | null;
    path: string | null;
};

const EVENT_LABELS = { SPEEDING: "Zu schnell", OFFLINE: "Kein Signal" } as const;

const plain = (value: string | number | null | undefined) =>
    value === null || value === undefined ? "" : String(value);

const meters = (value: number | null) =>
    value === null ? "" : value.toLocaleString("de-DE", { maximumFractionDigits: 0 });

/**
 * Everything the app stores about one driver of the company, for a request
 * under Art. 15 GDPR: master data, the vehicles, trips with their route,
 * events on them, warnings, and the workshop stays the person was to bring
 * the vehicle to. Undefined when the driver is not the company's.
 */
export function driverExport(
    companyId: number,
    driverId: number,
): { name: string; zip: Uint8Array } | undefined {
    const driver = stmt(
        `
        SELECT d.id, d.name, d.phone, d.licence_expires_on, d.licence_checked_on,
               d.created_at, c.name AS company_name
        FROM drivers d
        JOIN companies c ON c.id = d.company_id
        WHERE d.id = ? AND d.company_id = ?
        `,
    ).get(driverId, companyId) as DriverRow | undefined;

    if (!driver) {
        return undefined;
    }

    const vehicles = stmt(
        `
        SELECT v.license_plate,
               EXISTS (SELECT 1 FROM driver_vehicles dv WHERE dv.driver_id = ? AND dv.vehicle_id = v.id) AS eligible,
               v.current_driver_id = ? AS current
        FROM vehicles v
        WHERE v.company_id = ?
          AND (v.current_driver_id = ?
               OR EXISTS (SELECT 1 FROM driver_vehicles dv WHERE dv.driver_id = ? AND dv.vehicle_id = v.id))
        ORDER BY v.license_plate
        `,
    ).all(driverId, driverId, companyId, driverId, driverId) as {
        license_plate: string;
        eligible: number;
        current: number;
    }[];

    const trips = stmt(
        `
        SELECT t.id, v.license_plate, t.started_at, t.ended_at, t.distance_m, t.max_speed, t.path
        FROM trips t
        JOIN vehicles v ON v.id = t.vehicle_id
        WHERE t.driver_id = ? AND v.company_id = ?
        ORDER BY t.started_at DESC, t.id DESC
        `,
    ).all(driverId, companyId) as TripRow[];

    const events = stmt(
        `
        SELECT e.type, e.started_at, e.ended_at, e.from_m, e.to_m, e.max_speed_kmh,
               e.limit_kmh, e.estimated, t.started_at AS trip_started_at, v.license_plate
        FROM trip_events e
        JOIN trips t ON t.id = e.trip_id
        JOIN vehicles v ON v.id = t.vehicle_id
        WHERE t.driver_id = ? AND v.company_id = ?
        ORDER BY e.started_at DESC, e.id DESC
        `,
    ).all(driverId, companyId) as {
        type: keyof typeof EVENT_LABELS;
        started_at: string;
        ended_at: string | null;
        from_m: number;
        to_m: number | null;
        max_speed_kmh: number | null;
        limit_kmh: number | null;
        estimated: number;
        trip_started_at: string;
        license_plate: string;
    }[];

    const alerts = stmt(
        `
        SELECT v.license_plate, a.type, a.severity, a.message, a.details,
               a.created_at, a.ended_at, a.resolved_at, a.resolution_note
        FROM alerts a
        JOIN vehicles v ON v.id = a.vehicle_id
        WHERE a.driver_id = ? AND v.company_id = ?
        ORDER BY a.created_at DESC, a.id DESC
        `,
    ).all(driverId, companyId) as {
        license_plate: string;
        type: AlertType;
        severity: AlertSeverity;
        message: string;
        details: string | null;
        created_at: string;
        ended_at: string | null;
        resolved_at: string | null;
        resolution_note: string | null;
    }[];

    // Damages reported while this person drove the vehicle (snapshot at the report).
    const damages = stmt(
        `
        SELECT v.license_plate, d.occurred_on, d.occurred_time, d.description, d.severity,
               d.drivable, d.latitude, d.longitude, d.state,
               (SELECT COUNT(*) FROM damage_photos p WHERE p.damage_id = d.id) AS photos
        FROM vehicle_damages d
        JOIN vehicles v ON v.id = d.vehicle_id
        WHERE d.driver_id = ? AND v.company_id = ?
        ORDER BY d.occurred_on DESC, d.id DESC
        `,
    ).all(driverId, companyId) as {
        license_plate: string;
        occurred_on: string;
        occurred_time: string | null;
        description: string;
        severity: DamageSeverity;
        drivable: number;
        latitude: number | null;
        longitude: number | null;
        state: DamageState;
        photos: number;
    }[];

    const workshopStays = stmt(
        `
        SELECT v.license_plate, w.reasons, w.transport, w.state, w.place, w.planned_on, w.planned_time,
               w.arrived_at, w.finished_on, w.picked_up_at
        FROM workshop_visits w
        JOIN vehicles v ON v.id = w.vehicle_id
        WHERE w.bring_driver_id = ? AND v.company_id = ?
        ORDER BY w.planned_on DESC, w.id DESC
        `,
    ).all(driverId, companyId) as {
        license_plate: string;
        reasons: string;
        transport: WorkshopTransport;
        state: WorkshopState;
        place: string;
        planned_on: string;
        planned_time: string | null;
        arrived_at: string | null;
        finished_on: string | null;
        picked_up_at: string | null;
    }[];

    const retention = PrivacyModel.get(companyId);
    const exportedAt = formatStamp(new Date().toISOString());
    const routes = {
        type: "FeatureCollection",
        features: trips
            .filter((trip) => trip.path)
            .map((trip) => ({
                type: "Feature",
                properties: {
                    kennzeichen: trip.license_plate,
                    start: trip.started_at,
                    ende: trip.ended_at,
                },
                geometry: {
                    type: "LineString",
                    coordinates: decodePolyline(trip.path ?? "").map((point) => [point.lng, point.lat]),
                },
            })),
    };

    const readme = [
        `Auskunft über gespeicherte Daten zu: ${driver.name}`,
        `Firma: ${driver.company_name}`,
        `Erstellt: ${exportedAt}`,
        "",
        "Enthalten:",
        "- stammdaten.csv: Name, Telefon, Führerschein-Daten, angelegt am",
        "- fahrzeuge.csv: Fahrzeuge, die die Person fahren darf oder gerade fährt",
        "- fahrten.csv: Fahrten mit dieser Person als Fahrer",
        "- wege.geojson: die gefahrene Strecke jeder dieser Fahrten (Längengrad, Breitengrad)",
        "- ereignisse.csv: Tempo-Verstöße und Funklöcher auf diesen Fahrten",
        "- warnungen.csv: Warnungen, die beim Öffnen dieser Person zugeordnet waren",
        "- werkstatt.csv: Werkstatt-Aufenthalte, zu denen diese Person das Fahrzeug bringen sollte",
        "- schaeden.csv: Schäden, die gemeldet wurden, während diese Person das Fahrzeug fuhr (Ort und Zahl der Fotos; die Fotos selbst sind nicht in der Datei)",
        "",
        "Aufbewahrung dieser Firma:",
        `- Fahrten: ${retention.trips > 0 ? `${retention.trips} Tage nach dem Ende` : "ohne Frist"}`,
        `- Erledigte Warnungen: ${retention.alerts} Tage nach dem Erledigen`,
        `- Offene Warnungen und laufende Fahrten werden nicht gelöscht.`,
        "",
        "Nicht enthalten:",
        "- Live-Positionen der Fahrzeuge: nur die letzten 100 Meldungen je Fahrzeug, nicht der Person zugeordnet und laufend überschrieben.",
        `- Das Protokoll der Firma (${retention.audit ?? RETENTION_FALLBACK.audit} Tage) betrifft Konten, nicht Fahrer.`,
        "",
    ].join("\r\n");

    const files: Record<string, Uint8Array> = {
        "liesmich.txt": strToU8(`\uFEFF${readme}`),
        "stammdaten.csv": strToU8(
            toCsv([
                ["Name", "Telefon", "Führerschein gültig bis", "Führerschein geprüft am", "Angelegt am"],
                [
                    driver.name,
                    plain(driver.phone),
                    plain(driver.licence_expires_on),
                    plain(driver.licence_checked_on),
                    formatStamp(driver.created_at),
                ],
            ]),
        ),
        "fahrzeuge.csv": strToU8(
            toCsv([
                ["Kennzeichen", "Darf fahren", "Fährt gerade"],
                ...vehicles.map((row) => [
                    row.license_plate,
                    row.eligible ? "Ja" : "Nein",
                    row.current ? "Ja" : "Nein",
                ]),
            ]),
        ),
        "fahrten.csv": strToU8(
            toCsv([
                ["Kennzeichen", "Start", "Ende", "Strecke km", "Höchstgeschwindigkeit"],
                ...trips.map((row) => [
                    row.license_plate,
                    formatStamp(row.started_at),
                    formatStamp(row.ended_at),
                    formatKm(row.distance_m),
                    plain(row.max_speed === null ? null : Math.round(row.max_speed)),
                ]),
            ]),
        ),
        "wege.geojson": strToU8(JSON.stringify(routes)),
        "ereignisse.csv": strToU8(
            toCsv([
                ["Fahrt (Start)", "Kennzeichen", "Art", "Beginn", "Ende", "Ab Meter", "Bis Meter", "Tempo", "Limit", "Stelle geschätzt"],
                ...events.map((row) => [
                    formatStamp(row.trip_started_at),
                    row.license_plate,
                    EVENT_LABELS[row.type],
                    formatStamp(row.started_at),
                    formatStamp(row.ended_at),
                    meters(row.from_m),
                    meters(row.to_m),
                    plain(row.max_speed_kmh === null ? null : Math.round(row.max_speed_kmh)),
                    plain(row.limit_kmh === null ? null : Math.round(row.limit_kmh)),
                    row.estimated ? "Ja" : "Nein",
                ]),
            ]),
        ),
        "warnungen.csv": strToU8(
            toCsv([
                ["Kennzeichen", "Art", "Schwere", "Ereignis", "Zeitpunkt", "Ende", "Erledigt am", "Vermerk"],
                ...alerts.map((row) => [
                    row.license_plate,
                    ALERT_TYPE_LABELS[row.type],
                    ALERT_SEVERITY_LABELS[row.severity],
                    formatAlertEvent({
                        type: row.type,
                        message: row.message,
                        details: parseDetails(row.details),
                    }),
                    formatStamp(row.created_at),
                    formatStamp(row.ended_at),
                    formatStamp(row.resolved_at),
                    plain(row.resolution_note),
                ]),
            ]),
        ),
        "schaeden.csv": strToU8(
            toCsv([
                ["Kennzeichen", "Datum", "Uhrzeit", "Was", "Schwere", "Fahrbereit", "Breite", "Länge", "Fotos", "Stand"],
                ...damages.map((row) => [
                    row.license_plate,
                    row.occurred_on,
                    plain(row.occurred_time),
                    row.description,
                    DAMAGE_SEVERITY_LABELS[row.severity],
                    Number(row.drivable) === 1 ? "Ja" : "Nein",
                    row.latitude === null ? "" : String(row.latitude),
                    row.longitude === null ? "" : String(row.longitude),
                    String(row.photos),
                    DAMAGE_STATE_LABELS[row.state],
                ]),
            ]),
        ),
        "werkstatt.csv": strToU8(
            toCsv([
                ["Kennzeichen", "Grund", "Hinbringen", "Werkstatt", "Termin", "Uhrzeit", "Stand", "Angekommen", "Fertig am", "Abgeholt"],
                ...workshopStays.map((row) => [
                    row.license_plate,
                    workshopReasonsText(parseWorkshopReasons(row.reasons)),
                    WORKSHOP_TRANSPORT_LABELS[row.transport],
                    row.place,
                    row.planned_on,
                    plain(row.planned_time),
                    WORKSHOP_STATE_LABELS[row.state],
                    formatStamp(row.arrived_at),
                    plain(row.finished_on),
                    formatStamp(row.picked_up_at),
                ]),
            ]),
        ),
    };

    return { name: driver.name, zip: zipSync(files) };
}
