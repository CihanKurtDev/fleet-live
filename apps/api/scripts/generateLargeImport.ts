import { writeFileSync, existsSync } from "node:fs";
import { buildXlsxWorkbook } from "../src/lib/xlsxParse.ts";

const FIRST = [
    "Nora",
    "Leo",
    "Jonas",
    "Elif",
    "Finn",
    "Paul",
    "Mia",
    "Yusuf",
    "Lara",
    "Tim",
    "Emma",
    "Ben",
    "Sofia",
    "Max",
    "Hannah",
    "Luca",
    "Clara",
    "Omar",
    "Lea",
    "Niklas",
    "Anna",
    "David",
    "Marie",
    "Can",
    "Julia",
    "Felix",
    "Amira",
    "Lina",
    "Tom",
    "Sara",
    "Jan",
    "Mira",
    "Erik",
    "Zoe",
    "Ali",
    "Nina",
    "Kai",
    "Ida",
    "Sam",
    "Luis",
];
const LAST = [
    "Weber",
    "Krüger",
    "Kaya",
    "Hoffmann",
    "Schröder",
    "Arslan",
    "Neumann",
    "Bauer",
    "Richter",
    "Schmidt",
    "Müller",
    "Fischer",
    "Wagner",
    "Becker",
    "Schulz",
    "Koch",
    "Lange",
    "Klein",
    "Wolf",
    "Schwarz",
    "Zimmermann",
    "Braun",
    "Hofmann",
    "Hartmann",
    "Schmitt",
    "Werner",
    "Schmitz",
    "Krause",
    "Lehmann",
    "König",
];
const STATUSES = [
    "Auf Fahrt",
    "Auf Fahrt",
    "Standby",
    "Standby",
    "Standby",
    "Feierabend",
    "Kein Signal",
];
const PREFIXES = ["K-XLS", "B-FL", "M-TR", "HH-FN", "S-PX"];

const VEHICLE_N = 3500;
const DRIVER_N = 2800;
const ELIG_PER = 3;

function nameAt(i: number): string {
    const base =
        FIRST[i % FIRST.length]! +
        " " +
        LAST[Math.floor(i / FIRST.length) % LAST.length]!;
    const cycle = Math.floor(i / (FIRST.length * LAST.length));
    return cycle > 0 ? `${base} ${cycle + 1}` : base;
}

function plateAt(i: number): string {
    return `${PREFIXES[i % PREFIXES.length]!} ${String(1000 + (i % 9000))}`;
}

const vehicles: string[][] = [["Kennzeichen", "Tank", "Status"]];
for (let i = 0; i < VEHICLE_N; i += 1) {
    vehicles.push([
        plateAt(i),
        String(5 + ((i * 17) % 95)),
        STATUSES[i % STATUSES.length]!,
    ]);
}

const drivers: string[][] = [["Name"]];
const usedNames = new Set<string>();
for (let i = 0; i < DRIVER_N; i += 1) {
    let n = nameAt(i);
    let k = 1;
    while (usedNames.has(n)) {
        k += 1;
        n = `${nameAt(i)} ${k}`;
    }
    usedNames.add(n);
    drivers.push([n]);
}

const driverNames = drivers.slice(1).map((row) => row[0]!);
const eligibility: string[][] = [["Fahrer", "Kennzeichen"]];
for (let i = 0; i < DRIVER_N; i += 1) {
    const driver = driverNames[i]!;
    for (let e = 0; e < ELIG_PER; e += 1) {
        eligibility.push([driver, plateAt((i * ELIG_PER + e) % VEHICLE_N)]);
    }
}

const current: string[][] = [["Fahrer", "Kennzeichen"]];
for (let i = 0; i < Math.min(DRIVER_N, VEHICLE_N); i += 1) {
    current.push([driverNames[i]!, plateAt((i + 7) % VEHICLE_N)]);
}

const buffer = buildXlsxWorkbook([
    { name: "Fahrzeuge", rows: vehicles },
    { name: "Fahrer", rows: drivers },
    { name: "Eignung", rows: eligibility },
    { name: "Aktuell", rows: current },
]);

const out = "C:/Users/cihan/Downloads/import-beispiel-gross.xlsx";
writeFileSync(out, buffer);

const total =
    VEHICLE_N + DRIVER_N + (eligibility.length - 1) + (current.length - 1);

process.stdout.write(
    JSON.stringify(
        {
            out,
            exists: existsSync(out),
            bytes: buffer.length,
            vehicles: VEHICLE_N,
            drivers: DRIVER_N,
            eligibility: eligibility.length - 1,
            current: current.length - 1,
            total,
        },
        null,
        2,
    ),
);
