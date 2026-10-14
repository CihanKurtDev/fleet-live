// PostToolUse: run ESLint on the TypeScript file Claude just edited in apps/web
// or apps/api. Problems go back to Claude (exit 2); everything else passes.
import { spawnSync } from "node:child_process";
import path from "node:path";

let raw = "";
for await (const chunk of process.stdin) {
    raw += chunk;
}

const payload = JSON.parse(raw || "{}");
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const target = payload.tool_input?.file_path ?? payload.tool_response?.filePath ?? "";
const relative = path.relative(root, path.resolve(root, target)).split(path.sep).join("/");
const match = /^apps\/(web|api)\/(.+\.(?:ts|tsx))$/.exec(relative);

if (!match) {
    process.exit(0);
}

const [, app, file] = match;
const result = spawnSync("npx", ["eslint", "--no-warn-ignored", file], {
    cwd: path.join(root, "apps", app),
    encoding: "utf8",
    shell: process.platform === "win32",
});

if (result.status !== 0 && result.stdout.trim()) {
    process.stderr.write(`ESLint on ${relative}:\n${result.stdout.trim()}\n`);
    process.exit(2);
}

process.exit(0);
