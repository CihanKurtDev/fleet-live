import { backfillMissingPositions } from "../src/db/backfillPositions";

const dryRun = process.argv.includes("--dry-run");
const companyFlag = process.argv.indexOf("--company-id");
const companyRaw =
    companyFlag >= 0 ? process.argv[companyFlag + 1] : undefined;
const companyId =
    companyRaw === undefined ? undefined : Number(companyRaw);

if (
    companyRaw !== undefined &&
    (!Number.isInteger(companyId) || (companyId ?? 0) <= 0)
) {
    console.error("--company-id braucht eine positive ganze Zahl.");
    process.exit(1);
}

const result = backfillMissingPositions({ dryRun, companyId });
const vehicles = result.companies.reduce(
    (sum, company) => sum + company.total,
    0,
);

if (vehicles === 0) {
    console.log("Keine Fahrzeuge ohne Position.");
} else {
    for (const company of result.companies) {
        console.log(
            `Firma ${company.companyId}: ${company.total} ${
                company.total === 1 ? "Fahrzeug" : "Fahrzeuge"
            }`,
        );
        for (const depot of company.byDepot) {
            console.log(`  ${depot.label}: ${depot.count}`);
        }
    }
}

if (dryRun) {
    console.log("Dry-Run, nichts geschrieben.");
} else {
    console.log(`${result.inserted} Telemetriepunkte geschrieben.`);
}
