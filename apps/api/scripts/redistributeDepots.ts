import { redistributeDepots } from "../src/db/redistributeDepots";
import { config } from "../src/config";

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
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

if (config.nodeEnv !== "development" && !force) {
    console.error(
        "Umverteilung läuft nur in der Entwicklung oder mit --force.",
    );
    process.exit(1);
}

const result = redistributeDepots({
    dryRun,
    companyId,
    force: true,
});
let updated = 0;

for (const company of result.companies) {
    const vehicles = company.updated + company.unchanged;
    updated += company.updated;
    console.log(
        `Firma ${company.companyId}: ${vehicles} ${
            vehicles === 1 ? "Fahrzeug" : "Fahrzeuge"
        }, ${company.updated} ${dryRun ? "würden geändert" : "geändert"}`,
    );

    for (const depot of company.depots) {
        const counts = (["DRIVING", "IDLE", "STOPPED", "OFFLINE"] as const)
            .map((status) => `${status} ${depot.counts[status]}`)
            .join(", ");
        console.log(
            `  ${depot.name}${depot.wouldCreate ? " (neu)" : ""}: ${counts}`,
        );
    }
}

if (dryRun) {
    console.log("Dry-Run, nichts geschrieben.");
} else if (updated === 0) {
    console.log("Nichts geändert.");
} else {
    console.log(
        "Fertig. API neu starten, damit die Simulation die neuen Punkte übernimmt.",
    );
}
