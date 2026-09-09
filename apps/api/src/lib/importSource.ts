import type { ImportPreviewInput } from "@fleet-live/shared";
import { parseCsv, type CsvTable } from "./csvParse";
import { BadRequestError } from "./errors";
import { parseXlsxBase64 } from "./xlsxParse";

export function tableFromImportInput(input: ImportPreviewInput): CsvTable {
    if (input.xlsx) {
        return parseXlsxBase64(input.xlsx);
    }

    if (input.csv) {
        return parseCsv(input.csv);
    }

    throw new BadRequestError("Bitte CSV- oder Excel-Inhalt senden.");
}
