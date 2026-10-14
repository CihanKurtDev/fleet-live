---
description: After a PR was merged, update main and remove the merged branch
argument-hint: "[branch]"
---

The user merged the PR for `$ARGUMENTS` (if empty: the current branch).

1. Note the branch name, then `git switch main` and `git pull`.
2. Check that the merge contains the branch: `git diff --quiet main <branch>`. PRs are usually squash-merged, so ancestry checks fail; compare content.
3. Only if the content matches: `git branch -D <branch>`, and check with `git ls-remote --heads origin <branch>` whether the remote branch is gone (do not delete it yourself unless asked).
4. If it does not match, stop and show `git diff --stat main <branch>`.
5. Uncommitted files (for example under `.claude/`) stay as they are; never stash or reset them.

Report in German: new `main` commit, what was deleted, and anything left over.
