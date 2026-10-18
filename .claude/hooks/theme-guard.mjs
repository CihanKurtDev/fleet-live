// PostToolUse: the header switch sets data-theme on <html>; a component that
// asks the system scheme directly ignores it. Flags prefers-color-scheme in
// web sources outside utils/theme.ts (exit 2 sends the note back to Claude).
import { readFileSync } from "node:fs";
import path from "node:path";

let raw = "";
for await (const chunk of process.stdin) {
    raw += chunk;
}

const payload = JSON.parse(raw || "{}");
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const target = payload.tool_input?.file_path ?? payload.tool_response?.filePath ?? "";
const relative = path.relative(root, path.resolve(root, target)).split(path.sep).join("/");

if (
    !/^apps\/web\/src\/.+\.(?:ts|tsx|scss|css)$/.test(relative) ||
    relative === "apps/web/src/utils/theme.ts"
) {
    process.exit(0);
}

let text = "";
try {
    text = readFileSync(path.join(root, relative), "utf8");
} catch {
    process.exit(0);
}

const hits = text
    .split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => line.includes("prefers-color-scheme"));

if (hits.length > 0) {
    process.stderr.write(
        `${relative} reads prefers-color-scheme directly (${hits
            .map(({ number }) => `line ${number}`)
            .join(", ")}). The header switch overrides the system scheme: use :root[data-theme="dark"] in styles and isDarkTheme() / onThemeChange() from utils/theme.ts in code (rules/design-system.md).\n`,
    );
    process.exit(2);
}

process.exit(0);
