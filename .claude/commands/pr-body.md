---
description: Write a PR title and body for the current branch, ready to paste
---

Write a pull request title and body for the current branch.

1. Read `git log --oneline main..HEAD` and `git diff --stat main...HEAD`. Read the changed files where the commit messages are not enough.
2. Check that the branch is pushed (`git status -sb`). If not, say so and ask before pushing.
3. Title: English, conventional style (`feat:`, `fix:`, `docs:`), under 70 characters.
4. Body in English with sections: what changed (user-visible first), Checked (only checks that actually ran in this session or that you run now, with numbers), Not checked (honest), and a last line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
5. Never mention private files (`.claude/ROADMAP.md`, `.claude/MIGRATION_REPORT.md`, `.claude/archive/`).

Answer in German with the compare link `https://github.com/CihanKurtDev/fleet-live/compare/main...<branch>`, then the title and the body each in their own code block.
