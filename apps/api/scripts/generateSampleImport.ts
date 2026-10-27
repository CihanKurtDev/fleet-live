/**
 * Writes the sample files the import wizard offers
 * (`apps/web/public/import-beispiel.xlsx` and `.csv`): a fleet of about
 * 180 vehicles and 150 drivers at three depots (Köln, Düsseldorf, Bonn),
 * with eligibility, current crews and a realistic share of problems
 * (low tank, no signal, overdue or missing HU/UVV, expired licences,
 * old licence checks). A fixed seed keeps the files the same on every run.
 *
 * Run: `npm run sample:import -w api`
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildXlsxWorkbook } from "../src/lib/xlsxParse.ts";

const VEHICLE_N = 180;
const DRIVER_N = 150;
const CURRENT_N = 90;

const DEPOTS = [
    { name: "Köln", prefix: "K", costCenter: "KST-100", share: 0.5 },
    { name: "Düsseldorf", prefix: "D", costCenter: "KST-200", share: 0.3 },
    { name: "Bonn", prefix: "BN", costCenter: "KST-300", share: 0.2 },
] as const;

const FIRST = [
    "Nora", "Leo", "Jonas", "Elif", "Finn", "Paul", "Mia", "Yusuf", "Lara",
    "Tim", "Emma", "Ben", "Sofia", "Max", "Hannah", "Luca", "Clara", "Omar",
    "Lea", "Niklas", "Anna", "David", "Marie", "Can", "Julia", "Felix",
    "Amira", "Lina", "Tom", "Sara", "Jan", "Mira", "Erik", "Zoe", "Ali",
    "Nina", "Kai", "Ida", "Sam", "Luis", "Deniz", "Katarzyna", "Mehmet",
    "Olga", "Piotr", "Selin", "Tobias", "Vanessa", "Marco", "Aylin",
];
const LAST = [
    "Weber", "Krüger", "Kaya", "Hoffmann", "Schröder", "Arslan", "Neumann",
    "Bauer", "Richter", "Schmidt", "Müller", "Fischer", "Wagner", "Becker",
    "Schulz", "Koch", "Lange", "Klein", "Wolf", "Schwarz", "Zimmermann",
    "Braun", "Hartmann", "Schmitt", "Werner", "Schmitz", "Krause", "Lehmann",
    "König", "Nowak", "Yilmaz", "Demir", "Kowalski", "Petrović", "Rossi",
];
const TYPES: Array<[string, number]> = [
    ["Transporter", 0.5],
    ["LKW", 0.25],
    ["PKW", 0.2],
    ["Sonstiges", 0.05],
];
const PLATE_LETTERS = "ABCDEFGHJKLMNPRSTUVWXZ";
const VIN_CHARS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";

// mulberry32: small, seeded, the same numbers on every machine.
let seed = 20261027;
const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (min: number, max: number) =>
    min + Math.floor(random() * (max - min + 1));
const pick = <T>(items: readonly T[]) => items[int(0, items.length - 1)]!;
const weighted = <T>(items: ReadonlyArray<readonly [T, number]>) => {
    let roll = random();
    for (const [item, share] of items) {
        roll -= share;
        if (roll <= 0) return item;
    }
    return items[items.length - 1]![0];
};
const shuffle = <T>(items: T[]) => {
    for (let i = items.length - 1; i > 0; i -= 1) {
        const j = int(0, i);
        [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
};

/** TT.MM.JJJJ for a random day between two ISO dates. */
const dayBetween = (from: string, to: string) => {
    const start = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T00:00:00Z`);
    const day = new Date(start + random() * (end - start));
    const dd = String(day.getUTCDate()).padStart(2, "0");
    const mm = String(day.getUTCMonth() + 1).padStart(2, "0");
    return `${dd}.${mm}.${day.getUTCFullYear()}`;
};

/** Missing, overdue, due soon or fine, in the given shares. */
const deadline = (
    missing: number,
    overdue: number,
    soon: number,
    ranges: { overdue: [string, string]; soon: [string, string]; ok: [string, string] },
) => {
    const roll = random();
    if (roll < missing) return "";
    if (roll < missing + overdue) return dayBetween(...ranges.overdue);
    if (roll < missing + overdue + soon) return dayBetween(...ranges.soon);
    return dayBetween(...ranges.ok);
};

const depotOf = () =>
    weighted(DEPOTS.map((depot) => [depot, depot.share] as const));

type SampleVehicle = {
    plate: string;
    depot: (typeof DEPOTS)[number];
    tank: string;
    vin: string;
    type: string;
    hu: string;
    uvv: string;
    status: string;
    driver: string;
};

const plates = new Set<string>();
const vins = new Set<string>();
const vehicles: SampleVehicle[] = [];

while (vehicles.length < VEHICLE_N) {
    const depot = depotOf();
    const plate = `${depot.prefix}-${pick([...PLATE_LETTERS])}${pick([...PLATE_LETTERS])} ${int(100, 9899)}`;
    if (plates.has(plate)) continue;
    plates.add(plate);

    let vin: string;
    do {
        vin = "WV1ZZZ" + Array.from({ length: 11 }, () => pick([...VIN_CHARS])).join("");
    } while (vins.has(vin));
    vins.add(vin);

    vehicles.push({
        plate,
        depot,
        tank: String(random() < 0.08 ? int(4, 14) : int(25, 98)),
        vin,
        type: weighted(TYPES),
        hu: deadline(0.04, 0.05, 0.06, {
            overdue: ["2026-02-01", "2026-09-30"],
            soon: ["2026-11-01", "2026-11-25"],
            ok: ["2027-01-01", "2028-12-31"],
        }),
        uvv: deadline(0.05, 0.05, 0.06, {
            overdue: ["2026-03-01", "2026-10-20"],
            soon: ["2026-10-30", "2026-11-24"],
            ok: ["2026-12-15", "2027-10-31"],
        }),
        status: "",
        driver: "",
    });
}

type SampleDriver = {
    name: string;
    depot: (typeof DEPOTS)[number];
    phone: string;
    licenceExpires: string;
    licenceChecked: string;
};

const names = new Set<string>();
const drivers: SampleDriver[] = [];

while (drivers.length < DRIVER_N) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    if (names.has(name)) continue;
    names.add(name);

    drivers.push({
        name,
        depot: depotOf(),
        phone:
            random() < 0.06
                ? ""
                : `+49 ${pick(["151", "152", "160", "170", "176"])} ${int(1000000, 9999999)}`,
        licenceExpires: deadline(0.05, 0.03, 0.04, {
            overdue: ["2026-05-01", "2026-10-20"],
            soon: ["2026-10-30", "2026-11-24"],
            ok: ["2027-03-01", "2034-12-31"],
        }),
        licenceChecked: deadline(0.04, 0.08, 0, {
            overdue: ["2025-11-01", "2026-03-31"],
            soon: ["2026-05-01", "2026-05-01"],
            ok: ["2026-05-15", "2026-10-20"],
        }),
    });
}

// Each driver may drive two to four vehicles of their own depot.
const eligibility: Array<[string, string]> = [];
const eligibleOf = new Map<string, string[]>();
for (const driver of drivers) {
    const local = shuffle(vehicles.filter((vehicle) => vehicle.depot === driver.depot));
    const allowed = local.slice(0, int(2, 4)).map((vehicle) => vehicle.plate);
    eligibleOf.set(driver.name, allowed);
    for (const plate of allowed) eligibility.push([driver.name, plate]);
}

// About 90 drivers sit in one of their vehicles; most of those are driving.
const current: Array<[string, string]> = [];
const taken = new Set<string>();
for (const driver of shuffle([...drivers])) {
    if (current.length >= CURRENT_N) break;
    const plate = eligibleOf.get(driver.name)!.find((candidate) => !taken.has(candidate));
    if (!plate) continue;
    taken.add(plate);
    current.push([driver.name, plate]);
    const vehicle = vehicles.find((entry) => entry.plate === plate)!;
    vehicle.driver = driver.name;
    vehicle.status = random() < 0.7 ? "Auf Fahrt" : "Standby";
}

// A vehicle only drives with a driver; the rest stand, rest or are silent.
for (const vehicle of vehicles) {
    if (vehicle.status) continue;
    vehicle.status = weighted([
        ["Standby", 0.45],
        ["Feierabend", 0.5],
        ["Kein Signal", 0.05],
    ] as const);
}

vehicles.sort((left, right) => left.plate.localeCompare(right.plate, "de"));

const vehicleRows = (withDriver: boolean) => [
    [
        "Kennzeichen", "Tank", "Status",
        ...(withDriver ? ["Fahrer"] : []),
        "VIN", "Fahrzeugtyp", "Depot", "HU", "UVV fällig", "Kostenstelle",
    ],
    ...vehicles.map((vehicle) => [
        vehicle.plate,
        vehicle.tank,
        vehicle.status,
        ...(withDriver ? [vehicle.driver] : []),
        vehicle.vin,
        vehicle.type,
        vehicle.depot.name,
        vehicle.hu,
        vehicle.uvv,
        vehicle.depot.costCenter,
    ]),
];

const publicDir = join(import.meta.dirname, "../../web/public");

writeFileSync(
    join(publicDir, "import-beispiel.xlsx"),
    buildXlsxWorkbook([
        { name: "Fahrzeuge", rows: vehicleRows(false) },
        {
            name: "Fahrer",
            rows: [
                ["Name", "Telefon", "Führerschein gültig bis", "Führerschein kontrolliert am"],
                ...drivers.map((driver) => [
                    driver.name,
                    driver.phone,
                    driver.licenceExpires,
                    driver.licenceChecked,
                ]),
            ],
        },
        { name: "Eignung", rows: [["Fahrer", "Kennzeichen"], ...eligibility] },
        { name: "Aktuell", rows: [["Fahrer", "Kennzeichen"], ...current] },
    ]),
);

writeFileSync(
    join(publicDir, "import-beispiel.csv"),
    `${vehicleRows(true)
        .map((row) => row.join(";"))
        .join("\n")}\n`,
    "utf8",
);

const count = (status: string) =>
    vehicles.filter((vehicle) => vehicle.status === status).length;

process.stdout.write(
    `${JSON.stringify(
        {
            vehicles: vehicles.length,
            drivers: drivers.length,
            eligibility: eligibility.length,
            current: current.length,
            driving: count("Auf Fahrt"),
            standby: count("Standby"),
            off: count("Feierabend"),
            noSignal: count("Kein Signal"),
            lowTank: vehicles.filter((vehicle) => Number(vehicle.tank) < 15).length,
        },
        null,
        2,
    )}\n`,
);
