export type CsvTable = {
    columns: string[];
    rows: string[][];
};

/**
 * Minimal RFC 4180-style CSV parser (comma or semicolon delimiter).
 */
export function parseCsv(content: string): CsvTable {
    const normalized = content.replace(/^\uFEFF/, "").trim();
    if (normalized === "") {
        return { columns: [], rows: [] };
    }

    const lines = splitCsvLines(normalized);
    if (lines.length === 0) {
        return { columns: [], rows: [] };
    }

    const delimiter = detectDelimiter(lines[0] ?? "");
    const parsedLines = lines.map((line) => parseCsvLine(line, delimiter));
    const [header, ...dataRows] = parsedLines;

    if (!header || header.every((cell) => cell.trim() === "")) {
        return { columns: [], rows: [] };
    }

    const columns = header.map((cell, index) => {
        const trimmed = cell.trim();
        return trimmed === "" ? `Spalte ${index + 1}` : trimmed;
    });

    const rows = dataRows.filter((row) =>
        row.some((cell) => cell.trim() !== ""),
    );

    return { columns, rows };
}

function detectDelimiter(headerLine: string): "," | ";" {
    const commas = (headerLine.match(/,/g) ?? []).length;
    const semicolons = (headerLine.match(/;/g) ?? []).length;
    return semicolons > commas ? ";" : ",";
}

function splitCsvLines(content: string): string[] {
    const lines: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < content.length; i += 1) {
        const char = content[i];
        const next = content[i + 1];

        if (char === '"') {
            if (inQuotes && next === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if ((char === "\n" || char === "\r") && !inQuotes) {
            if (char === "\r" && next === "\n") {
                i += 1;
            }
            lines.push(current);
            current = "";
            continue;
        }

        current += char;
    }

    if (current.length > 0 || lines.length > 0) {
        lines.push(current);
    }

    return lines;
}

function parseCsvLine(line: string, delimiter: "," | ";"): string[] {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        const next = line[i + 1];

        if (char === '"') {
            if (inQuotes && next === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === delimiter && !inQuotes) {
            cells.push(current);
            current = "";
            continue;
        }

        current += char;
    }

    cells.push(current);
    return cells;
}
