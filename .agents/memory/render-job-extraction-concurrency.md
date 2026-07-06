---
name: Render job ffmpeg extraction concurrency and OOM
description: Why concurrent/retried video render jobs can OOM the server via stacked ffmpeg frame-extraction processes, and the fix.
---

The DreamStick video renderer extracts pose clips and background clips to JPEG frame sequences via ffmpeg before compositing. Originally, all pose extractions for a render ran fully in parallel (`Promise.all` over ~7 poses), each spawning its own ffmpeg process.

**Why this caused OOM:** If a render job fails partway through pose/bg loading (e.g. bad theme name), the in-flight `Promise.all` extractions for that job are not cancelled — they keep running as orphaned promises, spawning ffmpeg processes that are never awaited or cleaned up. Retrying the request immediately (common during manual testing) starts a fresh batch of concurrent extractions on top of the still-running orphaned ones. Stacking several failed+retried jobs led to a dozen+ concurrent ffmpeg processes and exhausted container memory.

**How to apply:** Any code path that extracts video frames via ffmpeg in a render pipeline should go through a global concurrency-limited gate (e.g. an acquire/release semaphore capping total concurrent extractions across pose + background loading, not just within one call site) rather than raw `Promise.all`. When manually retrying failed test jobs against a render server, wait for the previous job to fully settle (or restart the workflow) before firing another, since failed jobs can leave orphaned subprocesses running.
