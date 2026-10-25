/**
 * Semikolon, weil Excel unter de-DE so trennt. Der Import liest beides.
 * Ein führendes `'` stoppt Formeln: `=`, `+`, `-`, `@`, auch nach Leerraum,
 * Tab oder Zeilenumbruch und in voller Breite (`＝` usw.).
 */
export function toCsv(rows: string[][]): string {
    const lines = rows.map((row) => row.map(csvCell).join(";"));
    return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function csvCell(value: string): string {
    let text = value.replace(/\r\n|\r|\n/g, " ");
    if (/^\s*[=+\-@＝＋－＠]/.test(text)) {
        text = `'${text}`;
    }

    if (/[;"\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }

    return text;
}
