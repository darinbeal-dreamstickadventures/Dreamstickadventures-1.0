import { Router } from "express";
import { execFile } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { db, executionsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { ExecuteCodeBody } from "@workspace/api-zod";

const router = Router();

const TIMEOUT_MS = 10_000;

router.post("/repl/execute", async (req, res) => {
  const parsed = ExecuteCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { code } = parsed.data;
  const tmpFile = join(tmpdir(), `repl-${randomBytes(8).toString("hex")}.mjs`);

  try {
    await writeFile(tmpFile, code, "utf-8");
  } catch (err) {
    req.log.error({ err }, "Failed to write temp file");
    res.status(500).json({ error: "Failed to prepare execution" });
    return;
  }

  const start = Date.now();

  const [stdout, stderr, exitCode] = await new Promise<[string, string, number]>((resolve) => {
    const proc = execFile(
      process.execPath,
      ["--input-type=module", "--experimental-vm-modules", tmpFile],
      { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        const code = err ? (err.code != null ? (typeof err.code === "number" ? err.code : 1) : 1) : 0;
        resolve([stdout, stderr, code]);
      }
    );
    void proc;
  });

  const durationMs = Date.now() - start;

  try {
    await unlink(tmpFile);
  } catch {
    // ignore cleanup error
  }

  const [row] = await db
    .insert(executionsTable)
    .values({ code, stdout, stderr, exitCode, durationMs })
    .returning();

  res.json({
    id: row.id,
    code: row.code,
    stdout: row.stdout,
    stderr: row.stderr,
    exitCode: row.exitCode,
    durationMs: row.durationMs,
    executedAt: row.executedAt.toISOString(),
  });
});

router.get("/repl/history", async (req, res) => {
  const rows = await db
    .select()
    .from(executionsTable)
    .orderBy(desc(executionsTable.executedAt))
    .limit(50);

  res.json(
    rows.map((r) => ({
      id: r.id,
      code: r.code,
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.exitCode,
      durationMs: r.durationMs,
      executedAt: r.executedAt.toISOString(),
    }))
  );
});

router.delete("/repl/history", async (req, res) => {
  await db.delete(executionsTable);
  res.status(204).send();
});

export default router;
