import { repairData } from "../src/db/repairData";
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
        "Die Korrektur läuft nur in der Entwicklung oder mit --force.",
    );
    process.exit(1);
}

const result = repairData({ dryRun, companyId });

for (const rule of result.rules) {
    const examples =
        rule.examples.length > 0 ? `  (z. B. ${rule.examples.join(", ")})` : "";

    console.log(
        `${String(rule.count).padStart(6)}  ${rule.label}${rule.count > 0 ? examples : ""}`,
    );
}

if (result.total === 0) {
    console.log("Nichts zu korrigieren.");
} else if (dryRun) {
    console.log("Dry-Run, nichts geschrieben.");
} else {
    console.log(
        "Fertig. Offene Seiten zeigen es nach dem nächsten Neuladen der Liste.",
    );
}
