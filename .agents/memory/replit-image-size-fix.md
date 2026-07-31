---
name: Replit 8 GiB image size — root causes and fix
description: How the production Docker image exceeded 8 GiB and what actually fixed it.
---

## The rule
`.git/objects` is packed into the Repl layer. Large binary files committed to git inflate the image even after `git rm --cached`. Must purge blobs from git history AND garbage-collect.

**Why:** Replit's build creates a "Repl layer" from the entire repo filesystem, including `.git/`. Old binary blobs remain in `.git/objects` until explicitly gc'd, even after removing from HEAD.

**How to apply:** Any time large files are committed to git and later removed, run:
```bash
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch <path>' \
  --prune-empty --tag-name-filter cat -- --all
git for-each-ref --format="delete %(refname)" refs/original | git update-ref --stdin
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```
Then force-push to GitHub.

## ffmpeg in Replit production
Use `pkgs.ffmpeg` via `installSystemDependencies({ packages: ["ffmpeg"] })` — Nix packages live in the cached Nix layer (separate from the Repl layer), so they cost nothing in Repl layer size. Do NOT use `ffmpeg-static` or `ffprobe-static` npm packages — `ffprobe-static` alone is 336 MB.

## git filter-branch + stash trap
`git filter-branch` rewrites stash refs, making `git stash pop` fail afterwards with "not a stash-like commit". Commit or discard all changes before running filter-branch — do not stash them.

## Build log access
`fetchDeploymentLogs` may return nothing even when the deployment is live. Use `listDeploymentBuilds` + `getDeploymentBuild` to access actual build logs (including the image size error).
