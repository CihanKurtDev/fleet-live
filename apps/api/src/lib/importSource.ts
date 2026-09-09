import type { ImportPreviewInput } from "@fleet-live/shared";
import { parseCsv } from "./csvParse";
import { BadRequestError } from "./errors";
import {
    parseXlsxWorkbookBase64,
    type NamedImportTable,
} from "./xlsxParse";

export type { NamedImportTable };

export function tablesFromImportInput(
    input: ImportPreviewInput,
): NamedImportTable[] {
    if (input.xlsx) {
        return parseXlsxWorkbookBase64(input.xlsx);
    }

    if (input.csv) {
        return [{ name: "CSV", table: parseCsv(input.csv) }];
    }

    throw new BadRequestError("Bitte CSV- oder Excel-Inhalt senden.");
}
