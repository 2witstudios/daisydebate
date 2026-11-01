import { spawn } from 'node:child_process';
import { launchPreparationRemaining } from './launch-browser-image-policy';

/** Own each CLI's process group, including any subprocesses, never a shared process. */
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
  const execute = async (
    command: 'docker' | 'tar',
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
    const child = spawn(command, [...args], { detached: true, stdio: 'pipe' });
    const pid = child.pid;
    if (pid) groups.add(pid);
    let stdout = '',
      diagnostics = '',
      timedOut = false,
      oversized = false;
    let stage: string | null = null;
    const progress = (chunk: Buffer) => {
      diagnostics = (diagnostics + chunk.toString()).slice(-65536);
      stage = recipeStage(diagnostics) ?? stage;
    };
    child.stdout.on('data', (chunk: Buffer) => {
      progress(chunk);
      if (stdout.length + chunk.length > 1048576) {
        oversized = true;
        if (pid) kill(pid);
      } else stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      progress(chunk);
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

      if (stage)
        process.stdout.write(
          `${JSON.stringify({ event: 'browser.image.recipe.stage', stage })}\n`,
        );
      if (oversized)
        throw new Error('Launch preparation output exceeded its fixed bound');
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
    run: (args: readonly string[], options?: Parameters<typeof execute>[2]) =>
      execute('docker', args, options),
    archiveManifest: (path: string) =>
      execute('tar', ['-xOf', path, 'manifest.json']),
    close: () => {
      process.removeListener('SIGTERM', abort);
      process.removeListener('SIGINT', abort);
    },
  };
}

/** Fixed allowlist only; raw command output and credentials never escape. */
function recipeStage(output: string): string | null {
  const stages = [
    ...output.matchAll(
      /^daisy-image-stage:(artifact-download|artifact-validation|nss-tools|inventory)$/gm,
    ),
  ];
  return stages.at(-1)?.[1] ?? null;
}
