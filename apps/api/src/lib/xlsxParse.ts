import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { BadRequestError } from "./errors";
import type { CsvTable } from "./csvParse";

const OLE_XLS = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);

function zipPath(
    files: Record<string, Uint8Array>,
    wanted: string,
): Uint8Array | undefined {
    const normalized = wanted.replace(/^\/+/, "").replace(/\\/g, "/");

    for (const [key, value] of Object.entries(files)) {
        if (key.replace(/^\/+/, "").replace(/\\/g, "/") === normalized) {
            return value;
        }
    }

    return undefined;
}

function readXml(
    files: Record<string, Uint8Array>,
    path: string,
): string | undefined {
    const bytes = zipPath(files, path);
    return bytes ? strFromU8(bytes) : undefined;
}

function unescapeXml(value: string): string {
    return value
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
            String.fromCharCode(Number.parseInt(hex, 16)),
        )
        .replace(/&#(\d+);/g, (_, dec: string) =>
            String.fromCharCode(Number(dec)),
        )
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function colLetters(index: number): string {
    let n = index + 1;
    let out = "";

    while (n > 0) {
        const rem = (n - 1) % 26;
        out = String.fromCharCode(65 + rem) + out;
        n = Math.floor((n - 1) / 26);
    }

    return out;
}

function cellCol(ref: string): number {
    const letters = ref.match(/^[A-Z]+/i)?.[0] ?? "A";
    let n = 0;

    for (const ch of letters.toUpperCase()) {
        n = n * 26 + (ch.charCodeAt(0) - 64);
    }

    return n - 1;
}

function firstAttr(attrs: string, name: string): string | undefined {
    const match = attrs.match(new RegExp(`\\b${name}="([^"]*)"`, "i"));
    return match?.[1];
}

function parseSharedStrings(xml: string): string[] {
    const items: string[] = [];
    const siRe = /<(?:[\w-]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?si>/gi;

    for (const match of xml.matchAll(siRe)) {
        const body = match[1] ?? "";
        const texts: string[] = [];
        const tRe = /<(?:[\w-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?t>/gi;

        for (const tMatch of body.matchAll(tRe)) {
            texts.push(unescapeXml(tMatch[1] ?? ""));
        }

        items.push(texts.join(""));
    }

    return items;
}

function cellValue(
    attrs: string,
    inner: string,
    shared: string[],
): string {
    const type = firstAttr(attrs, "t") ?? "";

    if (type === "inlineStr") {
        const tMatch = /<(?:[\w-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?t>/i.exec(
            inner,
        );
        return unescapeXml(tMatch?.[1] ?? "");
    }

    const vMatch = /<(?:[\w-]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?v>/i.exec(
        inner,
    );
    const raw = unescapeXml(vMatch?.[1] ?? "").trim();

    if (type === "s") {
        const index = Number(raw);
        return Number.isInteger(index) ? (shared[index] ?? "") : "";
    }

    if (type === "b") {
        return raw === "1" || raw.toLowerCase() === "true" ? "1" : "0";
    }

    return raw;
}

function parseSheet(xml: string, shared: string[]): string[][] {
    const rows: string[][] = [];
    const rowRe = /<(?:[\w-]+:)?row\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?row>/gi;

    for (const rowMatch of xml.matchAll(rowRe)) {
        const cells = new Map<number, string>();
        const cellRe =
            /<(?:[\w-]+:)?c\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:[\w-]+:)?c>)/gi;
        const rowXml = rowMatch[1] ?? "";

        for (const cellMatch of rowXml.matchAll(cellRe)) {
            const attrs = cellMatch[1] ?? "";
            const inner = cellMatch[2] ?? "";
            const ref = firstAttr(attrs, "r");
            if (!ref) {
                continue;
            }

            cells.set(cellCol(ref), cellValue(attrs, inner, shared));
        }

        if (cells.size === 0) {
            continue;
        }

        const width = Math.max(...cells.keys()) + 1;
        const row: string[] = [];

        for (let i = 0; i < width; i += 1) {
            row.push(cells.get(i) ?? "");
        }

        if (row.some((cell) => cell.trim() !== "")) {
            rows.push(row);
        }
    }

    return rows;
}

function firstSheetPath(
    files: Record<string, Uint8Array>,
): string | undefined {
    const workbook = readXml(files, "xl/workbook.xml");
    const rels = readXml(files, "xl/_rels/workbook.xml.rels");

    if (!workbook) {
        return undefined;
    }

    const sheetMatch =
        /<(?:[\w-]+:)?sheet\b([^>]*)\/?>/i.exec(workbook);
    const rId = sheetMatch ? firstAttr(sheetMatch[1] ?? "", "r:id") : undefined;

    if (rId && rels) {
        const relRe =
            /<(?:[\w-]+:)?Relationship\b([^>]*)\/?>/gi;

        for (const match of rels.matchAll(relRe)) {
            const attrs = match[1] ?? "";
            if (firstAttr(attrs, "Id") !== rId) {
                continue;
            }

            const target = firstAttr(attrs, "Target");
            if (!target) {
                break;
            }

            const normalized = target.replace(/\\/g, "/");
            if (normalized.startsWith("/")) {
                return normalized.replace(/^\/+/, "");
            }

            return `xl/${normalized.replace(/^\.\//, "")}`;
        }
    }

    if (zipPath(files, "xl/worksheets/sheet1.xml")) {
        return "xl/worksheets/sheet1.xml";
    }

    return undefined;
}

function decodeBase64(value: string): Buffer {
    const trimmed = value.trim();
    const comma = trimmed.indexOf(",");
    const payload = comma >= 0 ? trimmed.slice(comma + 1) : trimmed;

    return Buffer.from(payload, "base64");
}

export function parseXlsxBuffer(buffer: Buffer): CsvTable {
    if (buffer.length >= 4 && buffer.subarray(0, 4).equals(OLE_XLS)) {
        throw new BadRequestError(
            "Alte .xls-Dateien werden nicht gelesen. Bitte als .xlsx speichern.",
        );
    }

    let files: Record<string, Uint8Array>;

    try {
        files = unzipSync(new Uint8Array(buffer));
    } catch {
        throw new BadRequestError("Die Excel-Datei konnte nicht gelesen werden.");
    }

    const sheetPath = firstSheetPath(files);
    const sheetXml = sheetPath ? readXml(files, sheetPath) : undefined;

    if (!sheetXml) {
        throw new BadRequestError(
            "Die Excel-Datei enthält kein lesbares Tabellenblatt.",
        );
    }

    const sharedXml = readXml(files, "xl/sharedStrings.xml") ?? "";
    const shared = sharedXml ? parseSharedStrings(sharedXml) : [];
    const matrix = parseSheet(sheetXml, shared);

    if (matrix.length === 0) {
        return { columns: [], rows: [] };
    }

    const [header, ...dataRows] = matrix;
    const columns = (header ?? []).map((cell, index) => {
        const trimmed = cell.trim();
        return trimmed === "" ? `Spalte ${index + 1}` : trimmed;
    });

    const width = columns.length;
    const rows = dataRows.map((row) => {
        const padded = row.slice(0, width);

        while (padded.length < width) {
            padded.push("");
        }

        return padded;
    });

    return { columns, rows };
}

export function parseXlsxBase64(value: string): CsvTable {
    const buffer = decodeBase64(value);

    if (buffer.length === 0) {
        throw new BadRequestError("Die Excel-Datei ist leer.");
    }

    return parseXlsxBuffer(buffer);
}

/** Minimal .xlsx for tests — first sheet, shared strings. */
export function buildXlsx(rows: string[][]): Buffer {
    const strings: string[] = [];
    const indexOf = (value: string): number => {
        const existing = strings.indexOf(value);
        if (existing >= 0) {
            return existing;
        }

        strings.push(value);
        return strings.length - 1;
    };

    const sheetRows = rows.map((row, rowIndex) => {
        const cells = row.map((value, colIndex) => {
            const ref = `${colLetters(colIndex)}${rowIndex + 1}`;
            const si = indexOf(value);
            return `<c r="${ref}" t="s"><v>${si}</v></c>`;
        });

        return `<row r="${rowIndex + 1}">${cells.join("")}</row>`;
    });

    const sst = strings
        .map((value) => `<si><t>${escapeXml(value)}</t></si>`)
        .join("");

    const files: Record<string, Uint8Array> = {
        "[Content_Types].xml": strToU8(
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`,
        ),
        "_rels/.rels": strToU8(
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
        ),
        "xl/workbook.xml": strToU8(
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Import" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`,
        ),
        "xl/_rels/workbook.xml.rels": strToU8(
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`,
        ),
        "xl/sharedStrings.xml": strToU8(
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${sst}</sst>`,
        ),
        "xl/worksheets/sheet1.xml": strToU8(
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetRows.join("")}</sheetData>
</worksheet>`,
        ),
    };

    return Buffer.from(zipSync(files));
}
