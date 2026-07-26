---
name: ESM top-level await kills production server silently
description: Top-level await in any esbuild-bundled module causes the entry ESM module to be async, silently preventing app.listen() from being reached within the port-detection timeout.
---

## Rule
Never use `await import(...)` or any top-level `await` in modules that are bundled by esbuild into the server entry point. Use static imports instead.

**Why:** When esbuild bundles an ESM file that contains a top-level await (even inside a try-catch), the entire output bundle becomes an async module. Node.js evaluates the entry as a pending promise. If the await doesn't resolve quickly enough, the production container's port-detection timeout (60 s) expires before `app.listen()` is ever called. The process is killed with zero log output — no error, no startup message, nothing — because the crash happens before any `process.on('uncaughtException')` handlers are registered and before pino/console output can flush.

**How to apply:** Replace `await import('fs')` with `import { readdirSync, existsSync } from 'fs'` at the static import block at the top of the file. Node.js built-ins (`fs`, `path`, `crypto`, etc.) can always be imported statically even when the module is bundled for `platform: 'node'` — esbuild externalizes them automatically.

**Symptom to watch for:** Production build succeeds, image pushes fine, but "Creating Autoscale service" step fails. Deployment logs show server process starts (pid assigned) but port never opens, no output, SIGTERM after 60 s.
