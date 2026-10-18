// PreToolUse guard for fleet-live. Reads the hook payload on stdin and denies:
// - branches that start with cursor/ or claude/ (see rules/git-branches.md)
// - force pushes and commits directly on main
// - the demo seed, which replaces the grown dev data (rules/backend.md)
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

    if (
        /\bdb:seed\b|\bsrc[\\/]db[\\/]seed\.ts\b/.test(command) &&
        !/\bALLOW_SEED=1\b/.test(command)
    ) {
        deny(
            "The demo seed replaces the grown dev data in apps/api/data/fleetlive.db and cannot be undone from the seed. Fix data in place with SQL after a backup (rules/backend.md). Only when the user asked for a reseed: back up fleetlive.db*, then prefix the command with ALLOW_SEED=1.",
        );
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
