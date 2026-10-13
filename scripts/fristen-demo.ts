/**
 * Nur zum Ansehen. Nicht Teil der App.
 * Start im Projektordner: npx tsx scripts/fristen-demo.ts
 */
import {
    INTERNAL_DUE_NOTICE,
    buildConfiguredDueRows,
    classifyDueOn,
    classifyHuMonth,
    classifyLicenceInterval,
    dueRule,
    resolveUvvDue,
    type ConfiguredDueRow,
    type DueCalendarState,
    type DueKind,
} from "@fleet-live/shared";

const TODAY = "2026-10-13";
const LEAD_DAYS = dueRule("hu").lead_days;
const UVV_MONTHS = dueRule("uvv").interval_months ?? 0;
const CHECK_MONTHS = dueRule("licence_check").interval_months ?? 0;

type DemoRow = {
    pruefung: string;
    eingabe: string;
    heute: string;
    status: string;
    faellig: string;
    grund: string;
};

function de(iso: string | null): string {
    if (iso === null || iso === "") {
        return "—";
    }

    const [year, month, day] = iso.split("-");

    if (!day) {
        return `${month}.${year}`;
    }

    return `${day}.${month}.${year}`;
}

function statusName(state: DueCalendarState): string {
    if (state === "soon") {
        return "bald";
    }

    if (state === "overdue") {
        return "überfällig";
    }

    if (state === "missing") {
        return "Datum fehlt";
    }

    return "in Ordnung";
}

function listNote(listed: boolean): string {
    return listed
        ? "Steht in der Arbeitsliste."
        : "Steht nicht in der Arbeitsliste.";
}

function citation(kind: DueKind): string {
    const rule = dueRule(kind);

    if (rule.verified && rule.basis) {
        return rule.basis;
    }

    if (rule.rule_kind === "internal") {
        return `${INTERNAL_DUE_NOTICE}.`;
    }

    return "Gesetzestext wird nicht angezeigt.";
}

function listedKinds(input: {
    today: string;
    licenceCheckMonths: number;
    vehicle?: {
        active?: boolean;
        hu_due_on: string | null;
        uvv_checked_on: string | null;
        uvv_due_on: string | null;
    };
    driver?: {
        active?: boolean;
        licence_expires_on: string | null;
        licence_checked_on: string | null;
    };
}): ConfiguredDueRow[] {
    return buildConfiguredDueRows({
        today: input.today,
        leadDays: LEAD_DAYS,
        licenceCheckMonths: input.licenceCheckMonths,
        vehicles: input.vehicle
            ? [
                  {
                      id: 1,
                      license_plate: "Demo",
                      ...input.vehicle,
                  },
              ]
            : [],
        drivers: input.driver
            ? [
                  {
                      id: 1,
                      name: "Demo",
                      ...input.driver,
                  },
              ]
            : [],
    });
}

function huRow(
    month: string | null,
    today: string,
    eingabe: string,
): DemoRow {
    const result = classifyHuMonth(month, today, LEAD_DAYS);
    const listed = listedKinds({
        today,
        licenceCheckMonths: CHECK_MONTHS,
        vehicle: {
            hu_due_on: month,
            uvv_checked_on: null,
            uvv_due_on: null,
        },
    }).some((row) => row.kind === "hu");
    const grund =
        result.state === "missing"
            ? `Kein Monat eingetragen. ${citation("hu")} ${listNote(listed)}`
            : `Fällig am letzten Tag des Monats, dem ${de(result.due_on)}. ${citation("hu")} ${listNote(listed)}`;

    return {
        pruefung: "HU",
        eingabe,
        heute: de(today),
        status: statusName(result.state),
        faellig: de(result.due_on),
        grund,
    };
}

function uvvRow(
    checkedOn: string | null,
    manualDueOn: string | null,
    eingabe: string,
): DemoRow {
    const resolved = resolveUvvDue({
        checkedOn,
        manualDueOn,
        intervalMonths: UVV_MONTHS,
        today: TODAY,
    });
    const state =
        resolved.due_on === null
            ? "missing"
            : classifyDueOn(resolved.due_on, TODAY, LEAD_DAYS);
    const listed = listedKinds({
        today: TODAY,
        licenceCheckMonths: CHECK_MONTHS,
        vehicle: {
            hu_due_on: null,
            uvv_checked_on: checkedOn,
            uvv_due_on: manualDueOn,
        },
    }).some((row) => row.kind === "uvv");
    let herkunft: string;

    if (resolved.source === "missing") {
        herkunft = "Weder letzte Prüfung noch manuelles Datum.";
    } else if (resolved.source === "manual" && resolved.last_on === null) {
        herkunft = "Keine letzte Prüfung gespeichert. Das manuelle Datum gilt.";
    } else if (resolved.source === "manual") {
        herkunft = `Das manuelle Datum liegt nach der Prüfung vom ${de(resolved.last_on)} und gilt.`;
    } else if (manualDueOn) {
        herkunft = `Die Prüfung vom ${de(resolved.last_on)} plus ${UVV_MONTHS} Monate gilt. Das manuelle Datum liegt nicht danach und wird nicht genommen.`;
    } else {
        herkunft = `Die Prüfung vom ${de(resolved.last_on)} plus ${UVV_MONTHS} Monate gilt.`;
    }

    if (resolved.last_checked_in_future) {
        herkunft += " Das Prüfdatum liegt nach heute. Die Rechnung läuft trotzdem normal.";
    }

    return {
        pruefung: "UVV",
        eingabe,
        heute: de(TODAY),
        status: statusName(state),
        faellig: de(resolved.due_on),
        grund: `${herkunft} ${citation("uvv")} ${listNote(listed)}`,
    };
}

function licenceRow(expiresOn: string | null, eingabe: string): DemoRow {
    const state = classifyDueOn(expiresOn, TODAY, LEAD_DAYS);
    const listed = listedKinds({
        today: TODAY,
        licenceCheckMonths: 0,
        driver: {
            licence_expires_on: expiresOn,
            licence_checked_on: "2026-10-01",
        },
    }).some((row) => row.kind === "licence_expiry");
    const herkunft =
        state === "missing"
            ? "Kein Ablaufdatum."
            : "Es gilt das eingetragene Ablaufdatum.";

    return {
        pruefung: "Führerschein",
        eingabe,
        heute: de(TODAY),
        status: statusName(state),
        faellig: de(expiresOn),
        grund: `${herkunft} ${citation("licence_expiry")} ${listNote(listed)}`,
    };
}

function checkRow(
    checkedOn: string | null,
    months: number,
    eingabe: string,
): DemoRow {
    const result = classifyLicenceInterval({
        checkedOn,
        today: TODAY,
        intervalMonths: months,
        leadDays: LEAD_DAYS,
    });
    const listed = listedKinds({
        today: TODAY,
        licenceCheckMonths: months,
        driver: {
            licence_expires_on: "2027-01-01",
            licence_checked_on: checkedOn,
        },
    }).some((row) => row.kind === "licence_check");

    if (!result.included) {
        return {
            pruefung: "Führerscheinkontrolle",
            eingabe,
            heute: de(TODAY),
            status: "keine Zeile",
            faellig: "—",
            grund: `Intervall ist ${months}, die Kontrolle ist aus. ${citation("licence_check")} ${listNote(listed)}`,
        };
    }

    const futureNote = result.last_checked_in_future
        ? " Das Kontrolldatum liegt nach heute. Die Rechnung läuft trotzdem normal."
        : "";
    const herkunft =
        result.due_on === null
            ? "Keine Kontrolle gespeichert. Das zählt als überfällig."
            : `Letzte Kontrolle am ${de(result.last_on)} plus ${months} Monate.${futureNote}`;

    return {
        pruefung: "Führerscheinkontrolle",
        eingabe,
        heute: de(TODAY),
        status: statusName(result.state),
        faellig: de(result.due_on),
        grund: `${herkunft} ${citation("licence_check")} ${listNote(listed)}`,
    };
}

function inactiveVehicle(): DemoRow {
    const rows = listedKinds({
        today: TODAY,
        licenceCheckMonths: CHECK_MONTHS,
        vehicle: {
            active: false,
            hu_due_on: "2026-09",
            uvv_checked_on: null,
            uvv_due_on: null,
        },
    });

    return {
        pruefung: "Inaktives Fahrzeug",
        eingabe: "HU-Monat 09.2026, Fahrzeug inaktiv",
        heute: de(TODAY),
        status: rows.length === 0 ? "nicht in der Liste" : statusName(rows[0].state),
        faellig: "—",
        grund:
            rows.length === 0
                ? "Inaktiv. Die Liste enthält für dieses Fahrzeug keine Zeile."
                : "Unerwartet eine Zeile erzeugt.",
    };
}

function inactiveDriver(): DemoRow {
    const rows = listedKinds({
        today: TODAY,
        licenceCheckMonths: CHECK_MONTHS,
        driver: {
            active: false,
            licence_expires_on: null,
            licence_checked_on: null,
        },
    });

    return {
        pruefung: "Inaktiver Fahrer",
        eingabe: "Ablauf leer, Kontrolle leer, Fahrer inaktiv",
        heute: de(TODAY),
        status: rows.length === 0 ? "nicht in der Liste" : statusName(rows[0].state),
        faellig: "—",
        grund:
            rows.length === 0
                ? "Inaktiv. Die Liste enthält für diesen Fahrer keine Zeile."
                : "Unerwartet eine Zeile erzeugt.",
    };
}

const rows: DemoRow[] = [
    huRow("2026-10", TODAY, "Monat 10.2026"),
    huRow("2026-09", TODAY, "Monat 09.2026"),
    huRow("2026-11", TODAY, "Monat 11.2026"),
    huRow(null, TODAY, "leer"),
    huRow("2026-10", "2026-10-31", "Monat 10.2026"),
    huRow("2026-10", "2026-11-01", "Monat 10.2026"),
    uvvRow("2026-04-15", null, "geprüft 15.04.2026"),
    uvvRow("2025-10-15", null, "geprüft 15.10.2025"),
    uvvRow(null, null, "leer"),
    uvvRow(null, "2026-03-01", "nur manuell 01.03.2026"),
    uvvRow(
        "2026-10-15",
        "2026-03-01",
        "manuell 01.03.2026 und geprüft 15.10.2026",
    ),
    uvvRow(
        "2026-10-15",
        "2026-10-15",
        "manuell 15.10.2026 und geprüft 15.10.2026",
    ),
    uvvRow(
        "2026-03-01",
        "2026-03-01",
        "manuell 01.03.2026 und geprüft 01.03.2026",
    ),
    uvvRow("2027-01-15", null, "geprüft 15.01.2027"),
    licenceRow("2026-10-20", "Ablauf 20.10.2026"),
    licenceRow("2026-11-12", "Ablauf 12.11.2026"),
    licenceRow("2026-09-01", "Ablauf 01.09.2026"),
    licenceRow(null, "leer"),
    checkRow("2026-04-20", CHECK_MONTHS, `Kontrolle 20.04.2026, Intervall ${CHECK_MONTHS}`),
    checkRow("2026-07-20", CHECK_MONTHS, `Kontrolle 20.07.2026, Intervall ${CHECK_MONTHS}`),
    checkRow("2025-08-31", CHECK_MONTHS, `Kontrolle 31.08.2025, Intervall ${CHECK_MONTHS}`),
    checkRow(null, CHECK_MONTHS, `leer, Intervall ${CHECK_MONTHS}`),
    checkRow(
        "2027-01-15",
        CHECK_MONTHS,
        `Kontrolle 15.01.2027, Intervall ${CHECK_MONTHS}`,
    ),
    checkRow(null, 0, "leer, Intervall 0 (aus)"),
    inactiveVehicle(),
    inactiveDriver(),
];

console.log(
    `Vorlauf aus der Regeldatei: ${LEAD_DAYS} Tage. UVV: ${UVV_MONTHS} Monate. Kontrolle normal: ${CHECK_MONTHS} Monate.`,
);
console.log("");

for (const row of rows) {
    console.log(`Prüfung:    ${row.pruefung}`);
    console.log(`Eingabe:    ${row.eingabe}`);
    console.log(`Heute:      ${row.heute}`);
    console.log(`Status:     ${row.status}`);
    console.log(`Fällig:     ${row.faellig}`);
    console.log(`Begründung: ${row.grund}`);
    console.log("");
}
