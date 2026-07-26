import('./index.js').catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write('\n[STARTUP_CRASH] ' + msg + '\n');
  process.exit(1);
});
