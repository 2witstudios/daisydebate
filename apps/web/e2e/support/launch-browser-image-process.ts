import { spawn } from 'node:child_process';
import { launchPreparationRemaining } from './launch-browser-image-policy';

/** Own each CLI's process group, including its buildx plugin, never a shared process. */
export function createLaunchPreparationProcess(budgetMs = 480000) {
  const started = performance.now();
  let interrupted = false;
  const groups = new Set<number>();
  const kill = (pid: number) => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* Already reaped. */
    }
  };
  const abort = () => {
    interrupted = true;
    for (const pid of groups) kill(pid);
  };
  process.once('SIGTERM', abort);
  process.once('SIGINT', abort);
  const run = async (
    args: readonly string[],
    options: {
      readonly stdin?: string;
      readonly cleanup?: boolean;
      readonly limitMs?: number;
    } = {},
  ) => {
    const remaining = launchPreparationRemaining(
      budgetMs,
      performance.now() - started,
      options.cleanup ?? false,
    );
    if (remaining <= 0 || (interrupted && !options.cleanup))
      throw new Error(
        'Launch image preparation deadline; rerun preparation after checking Docker and upstream availability',
      );
    const child = spawn('docker', [...args], { detached: true, stdio: 'pipe' });
    const pid = child.pid;
    if (pid) groups.add(pid);
    let stdout = '',
      diagnostics = '',
      timedOut = false;
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      diagnostics = (diagnostics + chunk.toString()).slice(-65536);
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(options.stdin);
    const timer = setTimeout(
      () => {
        timedOut = true;
        if (pid) kill(pid);
      },
      Math.min(remaining, options.limitMs ?? remaining),
    );
    try {
      const code = await new Promise<number>((resolve) => {
        child.once('error', () => resolve(127));
        child.once('close', (code) => resolve(code ?? 1));
      });
      const stage = buildStage(diagnostics);
      if (stage)
        process.stdout.write(
          `${JSON.stringify({ event: 'browser.image.build.stage', stage })}\n`,
        );
      if (timedOut || (interrupted && !options.cleanup))
        throw new Error(
          `Launch image preparation interrupted or deadline exceeded (stage: ${stage ?? 'docker-command'}); rerun after checking Docker and upstream availability`,
        );
      return { code, stdout };
    } finally {
      clearTimeout(timer);
      if (pid) groups.delete(pid);
    }
  };
  return {
    run,
    close: () => {
      process.removeListener('SIGTERM', abort);
      process.removeListener('SIGINT', abort);
    },
  };
}

/** Fixed allowlist only; no URLs, arbitrary error messages or credentials escape. */
function buildStage(output: string): string | null {
  if (
    output.includes('exporting to docker') ||
    output.includes('exporting layers')
  )
    return 'export';
  if (output.includes('RUN timeout')) return 'nss-tools';
  if (output.includes('FROM mcr.microsoft.com/playwright'))
    return 'base-layers';
  if (output.includes('load metadata for')) return 'base-metadata';
  if (output.includes('booting buildkit')) return 'backend-start';
  return null;
}
