import {
    DUE_KIND_LABELS,
    type TodayGroup,
    type TodayItem,
    type TodayKind,
    type TodayResponse,
    type TodaySection,
    type WeekItem,
} from "@fleet-live/shared";

import { formatCount } from "../../utils/formatCount";

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const WEEKDAYS_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

const weekdayIndex = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();

/** „Sa 14.11.“ */
export const dayLabel = (iso: string) => `${WEEKDAYS[weekdayIndex(iso)]} ${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

/** „14.11.“ */
export const shortDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

/** HU is a month: „04.2026“; a day: „06.11.2026“. */
export const formatDue = (value: string) => {
    const [year, month, day] = value.split("-");
    return day ? `${day}.${month}.${year}` : `${month}.${year}`;
};

/** „seit 06.11.“, „seit Ende April“ (HU is a month). */
const since = (value: string) => {
    if (value.length === 7) {
        const month = new Intl.DateTimeFormat("de-DE", { month: "long", timeZone: "UTC" }).format(
            new Date(`${value}-01T12:00:00Z`),
        );
        return `seit Ende ${month}`;
    }
    return `seit ${shortDate(value)}`;
};

export const SECTION_LABEL: Record<Exclude<TodaySection, "ending">, string> = {
    blocked: "Sofort klären",
    unchecked: "Nicht geprüft, aber im Einsatz",
};

/** One line beside the heading, so „Sofort klären“ is not read as the tile „Ausfall“. */
export const SECTION_HINT: Record<Exclude<TodaySection, "ending">, string> = {
    blocked: "fährt ohne gültige Papiere oder fehlt im Einsatz",
    unchecked: "Kontrolle überfällig oder Datum fehlt",
};

/** „Läuft heute ab“ on Monday to Thursday, „Läuft vor Montag ab“ on a Friday. */
export const endingLabel = (meta: TodayResponse["meta"]) =>
    meta.ending_until === meta.today
        ? "Läuft heute ab"
        : `Läuft vor ${WEEKDAYS_LONG[weekdayIndex(meta.next_workday)]} ab`;

const isWorkday = (iso: string) => {
    const day = weekdayIndex(iso);
    return day >= 1 && day <= 5;
};

/** A working day followed by days off (Friday): what runs out until then is settled today. */
export const isLastWorkdayBeforeBreak = (meta: TodayResponse["meta"]) =>
    meta.ending_until !== meta.today && isWorkday(meta.today);

/**
 * Licence rows stand alone: each one needs its own replacement. Other kinds
 * fold into one row from three tasks on.
 */
export const foldsInto = (group: TodayGroup) =>
    group.kind === "licence_driving" || group.kind === "licence_ending" ? group.count > 5 : group.count > 2;

const vehicleState = (item: TodayItem) => (item.vehicle_driving ? "fährt gerade" : "steht gerade");

/** A booked stay, or the vehicle is already there. */
export const stayText = (stay: TodayItem["stay"]) =>
    stay === null
        ? "kein Termin"
        : stay.state === "IN_WORKSHOP"
          ? `in der Werkstatt ${stay.place}`
          : `Termin ${shortDate(stay.planned_on)} bei ${stay.place}`;

/** The short form in the button column. */
export const stayNote = (stay: NonNullable<TodayItem["stay"]>) =>
    stay.state === "IN_WORKSHOP" ? "in der Werkstatt" : `Termin ${shortDate(stay.planned_on)}`;

const dueWhat = (item: TodayItem) => (item.due_kind ? DUE_KIND_LABELS[item.due_kind] : "Frist");

/** What the row is about, after the bold subject. */
export const rowWhat = (item: TodayItem): string => {
    switch (item.kind) {
        case "licence_driving":
            return `Führerschein ${item.due_on ? since(item.due_on) : ""} abgelaufen`;
        case "deadline_overdue":
            return `${dueWhat(item)} ${item.due_on ? since(item.due_on) : ""} abgelaufen`;
        case "workshop_due":
            return workshopWhat(item);
        case "damage_unplanned":
            return "nicht fahrbereit, kein Werkstatt-Termin";
        case "offline":
            return `kein Signal ${item.since ? `seit ${shortDate(item.since.slice(0, 10))}` : ""}`;
        case "check_overdue":
            return item.due_on ? `Führerscheinkontrolle ${since(item.due_on)} fällig` : "Führerschein noch nie kontrolliert";
        case "date_missing":
            return `${dueWhat(item)} ohne Datum, nicht prüfbar`;
        case "licence_ending":
            return item.due_on ? `Führerschein gilt bis ${dayLabel(item.due_on)}` : "Führerschein läuft ab";
        case "deadline_ending":
            return item.due_kind === "licence_check"
                ? `Führerscheinkontrolle fällig ${item.due_on ? dayLabel(item.due_on) : ""}`
                : `${dueWhat(item)} gilt bis ${item.due_on ? (item.due_on.length === 7 ? since(item.due_on).replace("seit ", "") : dayLabel(item.due_on)) : ""}`;
    }
};

const workshopWhat = (item: TodayItem) => {
    switch (item.workshop_task) {
        case "missed":
            return "Werkstatt-Termin verpasst";
        case "return_late":
            return `Werkstatt-Rückgabe ${item.workshop?.expected_on ? `seit ${shortDate(item.workshop.expected_on)} ` : ""}überfällig`;
        case "trip_no_driver":
            return "Werkstatt heute, niemand fährt hin";
        case "pickup":
            return "Werkstatt fertig, niemand holt es ab";
        case "unplanned":
            return "steht in einer Werkstatt ohne Termin";
        default:
            return "Werkstatt";
    }
};

const replacementText = (item: TodayItem) =>
    item.replacement ? `Ersatz: ${item.replacement.name} ist frei` : "kein freier Fahrer als Ersatz";

/** The second line: where it stands, who drives, what is booked. */
export const rowLine = (item: TodayItem): string => {
    const parts: Array<string | null> = (() => {
        switch (item.kind) {
            case "licence_driving":
                return [
                    item.vehicle_plate ? `${item.vehicle_plate} ${vehicleState(item)}` : null,
                    item.trips_since ? `seit Ablauf ${formatCount(item.trips_since)} ${item.trips_since === 1 ? "Fahrt" : "Fahrten"}, ${formatCount(item.km_since ?? 0)} km` : null,
                    replacementText(item),
                    item.phone ? `Tel. ${item.phone}` : "keine Telefonnummer",
                ];
            case "licence_ending":
                return [item.vehicle_plate ? `auf ${item.vehicle_plate}` : null, replacementText(item), item.phone ? `Tel. ${item.phone}` : "keine Telefonnummer"];
            case "deadline_overdue":
            case "deadline_ending":
                return item.due_kind === "licence_check"
                    ? [item.vehicle_plate ? `auf ${item.vehicle_plate}` : null, item.phone]
                    : [vehicleState(item), item.driver_name, stayText(item.stay)];
            case "workshop_due":
                return [
                    item.workshop_place?.name ?? item.workshop?.place ? `Werkstatt ${item.workshop_place?.name ?? item.workshop?.place}` : null,
                    item.workshop_place ? (item.workshop_place.phone ? `Tel. ${item.workshop_place.phone}` : "keine Telefonnummer") : null,
                ];
            case "damage_unplanned":
                return [item.damage?.description ?? null, item.damage ? `seit ${shortDate(item.damage.occurred_on)}` : null];
            case "offline":
                return [
                    item.driver_name ? `Fahrer ${item.driver_name}` : "kein Fahrer eingeteilt",
                    item.phone ? `Tel. ${item.phone}` : null,
                    "Gerät oder Fahrzeug prüfen lassen",
                ];
            case "check_overdue":
                return [item.vehicle_plate ? `auf ${item.vehicle_plate}` : null, item.vehicle_driving ? "fährt gerade" : null];
            case "date_missing":
                return item.driver_id !== null
                    ? [item.vehicle_plate ? `auf ${item.vehicle_plate}` : null]
                    : [vehicleState(item), item.driver_name];
        }
    })();
    return parts.filter((part): part is string => Boolean(part)).join(" · ");
};

const GROUP_WHAT: Record<TodayKind, string> = {
    licence_driving: "eingeteilte Fahrer: Führerschein abgelaufen",
    deadline_overdue: "Fahrzeuge im Einsatz mit abgelaufener HU oder UVV",
    workshop_due: "Fahrzeuge: die Werkstatt braucht dich",
    damage_unplanned: "Fahrzeuge nicht fahrbereit, kein Werkstatt-Termin",
    offline: "Fahrzeuge ohne Signal",
    check_overdue: "eingeteilte Fahrer: Führerscheinkontrolle überfällig",
    date_missing: "im Einsatz ohne Datum: nicht prüfbar",
    licence_ending: "eingeteilte Fahrer: Führerschein läuft ab",
    deadline_ending: "im Einsatz: Frist läuft ab oder Kontrolle wird fällig",
};

export const groupWhat = (group: TodayGroup) => GROUP_WHAT[group.kind];

const names = (items: TodayItem[], max = 3) => {
    const shown = items.slice(0, max).map((item) => item.subject);
    return items.length > max ? `${shown.join(", ")} und ${formatCount(items.length - max)} weitere` : shown.join(", ");
};

/** The second line of a folded group: what stands out in it. */
export const groupLine = (group: TodayGroup): string => {
    const { items } = group;
    const vehicleRows = items.every((item) => item.driver_id === null);
    if (!vehicleRows) {
        // People and vehicles mixed: name them by what is due.
        const byKind = new Map<string, TodayItem[]>();
        for (const item of items) {
            const label = dueWhat(item);
            byKind.set(label, [...(byKind.get(label) ?? []), item]);
        }
        return [...byKind.entries()].map(([label, list]) => `${label}: ${names(list, 2)}`).join(" · ");
    }
    if (group.kind === "deadline_overdue" || group.kind === "deadline_ending") {
        const driving = items.filter((item) => item.vehicle_driving);
        const booked = items.filter((item) => item.stay).length;
        return [
            driving.length > 0 ? `${formatCount(driving.length)} fahren gerade: ${names(driving, 2)}` : "keins fährt gerade",
            booked === 0 ? "keins hat einen Termin" : `${formatCount(booked)} mit Termin`,
        ].join(" · ");
    }
    return names(items);
};

/** Week cards: the kind on top. */
export const WEEK_KIND_LABEL: Record<WeekItem["kind"], string> = {
    licence_expiry: "Führerschein läuft ab",
    hu: "HU läuft ab",
    uvv: "UVV läuft ab",
    licence_check: "Kontrolle fällig",
    workshop: "Werkstatt-Termin",
};

/** A folded plan row: „4 Kontrollen fällig“. */
export const WEEK_GROUP_LABEL: Record<WeekItem["kind"], string> = {
    licence_expiry: "Führerscheine laufen ab",
    hu: "HU laufen ab",
    uvv: "UVV laufen ab",
    licence_check: "Kontrollen fällig",
    workshop: "Werkstatt-Termine",
};

export const weekDetail = (item: WeekItem) => {
    if (item.kind === "workshop") {
        return [item.stay?.place, item.stay?.planned_time ? `${item.stay.planned_time} Uhr` : null].filter(Boolean).join(" · ");
    }
    if (item.driver_id !== null) {
        return item.vehicle_plate ? `auf ${item.vehicle_plate}${item.vehicle_driving ? ", fährt" : ""}` : "";
    }
    return [item.driver_name, item.vehicle_driving ? "fährt" : null].filter(Boolean).join(", ");
};

/** „2 Führerscheine · 1 UVV ohne Termin · 11 Kontrollen · Werkstatt: keiner geplant“ */
export const weekNote = (items: WeekItem[]) => {
    const count = (test: (item: WeekItem) => boolean) => items.filter(test).length;
    const licences = count((item) => item.kind === "licence_expiry");
    const unbooked = count((item) => (item.kind === "hu" || item.kind === "uvv") && !item.stay);
    const checks = count((item) => item.kind === "licence_check");
    const stays = count((item) => item.kind === "workshop");
    return [
        licences > 0 ? `${formatCount(licences)} ${licences === 1 ? "Führerschein" : "Führerscheine"}` : null,
        unbooked > 0 ? `${formatCount(unbooked)} HU/UVV ohne Termin` : null,
        checks > 0 ? `${formatCount(checks)} ${checks === 1 ? "Kontrolle" : "Kontrollen"}` : null,
        `Werkstatt-Termine: ${stays === 0 ? "keiner geplant" : formatCount(stays)}`,
    ]
        .filter(Boolean)
        .join(" · ");
};
