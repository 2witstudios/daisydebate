import { createAppError } from '@daisy/errors';
// The deployment edge only. Native/vendor diagnostics cannot enter shared logs.
const child = Bun.spawn(
  [
    process.execPath,
    Bun.resolveSync('./capture-process.ts', import.meta.dir),
    ...process.argv.slice(2),
  ],
  {
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
    env: {
      PUBLIC_APP_URL: process.env.PUBLIC_APP_URL,
      MEDIA_WORKER_SECRET: process.env.MEDIA_WORKER_SECRET,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    },
  },
);
let stopping: Promise<void> | undefined;
const stop = () => {
  stopping ??= (async () => {
    child.kill('SIGTERM');
    const deadline = setTimeout(() => child.kill('SIGKILL'), 20000);
    try {
      await child.exited;
    } finally {
      clearTimeout(deadline);
    }
  })();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
try {
  process.exitCode = await child.exited;
} catch {
  throw createAppError('INFRASTRUCTURE', 'Capture process failed');
}
