---
name: pnpm prune strips native optional binaries
description: pnpm prune --prod removes optionalDependencies of production packages, including platform-specific native binaries like @napi-rs/canvas-linux-x64-gnu.
---

## Rule
When running `pnpm prune --prod` in a production build to reduce image size, add any required native binary packages as **direct dependencies** so prune cannot remove them.

**Why:** Packages like `@napi-rs/canvas` ship platform-specific binaries (e.g. `@napi-rs/canvas-linux-x64-gnu`) as `optionalDependencies`. `pnpm prune --prod` removes optional transitive dependencies, so the binary disappears from node_modules. The server then crashes at startup with `ERR_MODULE_NOT_FOUND: Cannot find package '@napi-rs/canvas'` (the main package is there but its binary isn't, so it throws on load).

**Fix:** Add the platform binary as a direct `dependency` in package.json:
```json
"@napi-rs/canvas-linux-x64-gnu": "1.0.1"
```
Now prune sees it as an explicit production dep and keeps it.

**Also:** `pnpm prune --prod` requires `CI=true` in non-interactive (production) environments, or it aborts with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`.
