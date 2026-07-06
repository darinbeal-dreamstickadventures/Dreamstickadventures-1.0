---
name: napi-rs/canvas getImageData memory leak in frame loops
description: Why per-frame video rendering with @napi-rs/canvas must use canvas.data() instead of ctx.getImageData(), and how the leak was diagnosed.
---

When piping rendered frames to ffmpeg in a tight per-frame loop (thousands of frames for a multi-scene video), calling `ctx.getImageData(0, 0, w, h)` every frame causes the Node process RSS to climb unboundedly (observed: ~1-2MB/frame, reaching 5+ GB and getting OOM-killed by the container over a few thousand frames).

**Why:** `getImageData()` allocates a brand-new `ImageData` wrapper object (with its own native pixel copy) on every call. The JS-side heap footprint of these objects looks tiny to V8, so garbage collection isn't triggered often enough to reclaim the underlying native/external memory — even explicit periodic `global.gc()` calls (via `--expose-gc`) did NOT fix it, ruling out simple GC-scheduling as the cause. Wrapping `.data.buffer` in `Buffer.from()` (zero-copy view) vs. copying `.data` also made no difference — the leak was in the `getImageData()` call itself, not in how the result was consumed.

**How to apply:** For any per-frame raw-pixel-buffer extraction loop with `@napi-rs/canvas`, use `canvas.data(): Buffer` (a direct raw-pixel accessor with no extra wrapper allocation) instead of `ctx.getImageData(...).data`. This kept memory flat (~200-250MB) across a 3600+ frame render that previously ballooned to 5.4GB and crashed. Check `node_modules/@napi-rs/canvas/index.d.ts` for the exact API on `Canvas` (not `SKRSContext2D`) when debugging similar issues after a library upgrade.
