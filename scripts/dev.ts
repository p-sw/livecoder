// ponytail: parallel dev orchestrator — replaces `concurrently` with native Bun.spawn.
// Add per-process logging prefixing when scaling beyond two services.
const procs = [
  Bun.spawn(['bun', '--cwd', 'apps/api', '--watch', 'src/main.ts'], {
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' },
  }),
  Bun.spawn(['bun', '--cwd', 'apps/web', 'dev'], {
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' },
  }),
];

const shutdown = () => {
  for (const proc of procs) {
    if (!proc.killed) proc.kill();
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await Promise.race(procs.map((proc) => proc.exited));
shutdown();
