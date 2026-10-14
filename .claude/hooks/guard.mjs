// PreToolUse guard for fleet-live. Reads the hook payload on stdin and denies:
// - branches that start with cursor/ or claude/ (see rules/git-branches.md)
// - force pushes and commits directly on main
import { execSync } from "node:child_process";

const deny = (reason) => {
    process.stdout.write(
        JSON.stringify({
            hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: reason,
            },
        }),
    );
    process.exit(0);
};

let raw = "";
for await (const chunk of process.stdin) {
    raw += chunk;
}

const payload = JSON.parse(raw || "{}");
const input = payload.tool_input ?? {};
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

if (payload.tool_name === "Bash") {
    const command = String(input.command ?? "");

    if (/\bgit\s+(?:checkout\s+-b|switch\s+(?:-c|--create)|branch)\s+(?:cursor|claude)\//.test(command)) {
        deny("Branch names start with feat/, fix/ or docs/, never cursor/ or claude/ (rules/git-branches.md).");
    }

    if (/\bgit\s+push\b[^\n;&|]*\s(?:--force(?:-with-lease)?|-f)\b/.test(command)) {
        deny("No force push in this repo.");
    }

    if (/\bgit\s+commit\b/.test(command)) {
        let branch = "";
        try {
            branch = execSync("git branch --show-current", { cwd: root, encoding: "utf8" }).trim();
        } catch {
            branch = "";
        }

        if (branch === "main") {
            deny("Do not commit on main. Create a feat/, fix/ or docs/ branch first.");
        }
    }
}

process.exit(0);
