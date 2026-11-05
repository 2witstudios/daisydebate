#!/usr/bin/env bun
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

/** Linux boot-relative elapsed time, shared with the workflow launch stamp. */
export const elapsedBootMs = () =>
  Number(readFileSync('/proc/uptime', 'utf8').split(' ')[0]) * 1000;
export const preparationDeadline = (launchSeconds: number) =>
  launchSeconds * 1000 + 230_000;

const apt = [
  'apt-get',
  '-o',
  'Acquire::Retries=1',
  '-o',
  'Acquire::http::Timeout=20',
  '-o',
  'Acquire::https::Timeout=20',
  '-o',
  'APT::Update::Error-Mode=any',
];
export const acquisitionCommands = () => [
  [...apt, 'update'],
  [
    ...apt,
    'install',
    '-y',
    '--no-install-recommends',
    '--download-only',
    'ffmpeg',
  ],
];

/** Zombies cannot perform work or hold package locks; their parent reaps them. */
export function liveGroupMembers(group: number) {
  return readdirSync('/proc')
    .filter((name) => /^\d+$/.test(name))
    .flatMap((name) => {
      try {
        const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
        const [state, , pgid] = stat
          .slice(stat.lastIndexOf(')') + 2)
          .split(' ');
        return Number(pgid) === group && state !== 'Z' && state !== 'X'
          ? [Number(name)]
          : [];
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code === 'ENOENT' ||
          (error as NodeJS.ErrnoException).code === 'ESRCH'
        )
          return [];
        throw error;
      }
    });
}

function signalGroup(group: number, signal: NodeJS.Signals) {
  try {
    process.kill(-group, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

async function before<T>(promise: Promise<T>, deadline: number, fallback: T) {
  let pending: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        pending = setTimeout(
          () => resolve(fallback),
          Math.max(0, deadline - elapsedBootMs()),
        );
      }),
    ]);
  } finally {
    clearTimeout(pending);
  }
}

export function createPreparation(
  launchSeconds: number,
  cancellation: AbortSignal,
) {
  const deadline = preparationDeadline(launchSeconds);
  const log = (message: string) =>
    console.log(
      `ffmpeg preparation +${((elapsedBootMs() - launchSeconds * 1000) / 1000).toFixed(2)}s: ${message}`,
    );
  const run = async (
    phase: string,
    command: readonly string[],
    phaseDeadline = deadline,
  ) => {
    const end = Math.min(deadline, phaseDeadline);
    if (cancellation.aborted || elapsedBootMs() >= end)
      throw new Error(`${phase}: preparation stopped or budget exhausted`);
    log(`${phase}: start`);
    const started = elapsedBootMs();
    const child = spawn(command[0]!, command.slice(1), {
      detached: true,
      stdio: 'inherit',
    });
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code));
    });
    const interrupted = new Promise<null>((resolve) =>
      cancellation.addEventListener('abort', () => resolve(null), {
        once: true,
      }),
    );
    let result: number | null = null;
    const cleanup = async () => {
      if (child.pid !== undefined) {
        // Preserve PGID after leader exit. A TERM-resistant member must still
        // receive KILL. This contains group members, not arbitrary setsid escapes.
        const cleanupEnd = Math.min(
          end + 6_000,
          deadline + 6_000,
          elapsedBootMs() + 6_000,
        );
        if (result === null) {
          signalGroup(child.pid, 'SIGTERM');
          await Bun.sleep(
            Math.max(0, Math.min(5_000, cleanupEnd - 1_000 - elapsedBootMs())),
          );
        }
        signalGroup(child.pid, 'SIGKILL');
        while (
          liveGroupMembers(child.pid).length > 0 &&
          elapsedBootMs() < cleanupEnd
        )
          await Bun.sleep(20);
        const reaped = await before(exited, cleanupEnd, null);
        if (
          liveGroupMembers(child.pid).length > 0 ||
          (reaped === null && child.signalCode === null)
        ) {
          throw new Error(`${phase}: process group cleanup unproven`, {
            cause: 'cleanup-unproven',
          });
        }
      }
    };
    try {
      result = await before(Promise.race([exited, interrupted]), end, null);
    } finally {
      await cleanup();
    }
    log(
      `${phase}: exit ${result}; ${((elapsedBootMs() - started) / 1000).toFixed(2)}s; group quiescent`,
    );
    if (result !== 0 || cancellation.aborted || elapsedBootMs() >= end)
      throw new Error(`${phase}: failed or deadline exceeded`, {
        cause: 'acquisition-failure',
      });
  };
  const checkReady = () => {
    if (cancellation.aborted || elapsedBootMs() >= deadline)
      throw new Error('preparation stopped or budget exhausted');
  };
  return { run, log, deadline, checkReady };
}

const sourceFiles =
  '/etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources /etc/apt/apt-mirrors.txt';

export async function prepareFfmpeg(
  runner: ReturnType<typeof createPreparation>,
) {
  await runner.run('configured package sources', [
    'sh',
    '-ec',
    `for file in ${sourceFiles}; do if [ -f "$file" ]; then echo "--- $file"; cat "$file"; fi; done`,
  ]);
  for (const attempt of [1, 2]) {
    const end = Math.min(runner.deadline, elapsedBootMs() + 80_000);
    try {
      for (const [index, command] of acquisitionCommands().entries())
        await runner.run(
          `${index === 0 ? 'update' : 'download'} attempt ${attempt}`,
          command,
          end,
        );
      break;
    } catch (error) {
      runner.log(String(error));
      if (
        attempt === 2 ||
        !(error instanceof Error) ||
        error.cause !== 'acquisition-failure'
      )
        throw error;
      await runner.run('primary Ubuntu mirror recovery', [
        'sh',
        '-ec',
        `for file in ${sourceFiles}; do if [ -f "$file" ]; then sed -i 's#azure\\.archive\\.ubuntu\\.com#archive.ubuntu.com#g' "$file"; fi; done`,
      ]);
      await runner.run('recovered package sources', [
        'sh',
        '-ec',
        `for file in ${sourceFiles}; do if [ -f "$file" ]; then echo "--- $file"; cat "$file"; fi; done`,
      ]);
    }
  }
  // No dpkg work can be entered by an acquisition retry.
  await runner.run('install (no downloads, no retry)', [
    ...apt,
    'install',
    '-y',
    '--no-install-recommends',
    '--no-download',
    'ffmpeg',
  ]);
  await runner.run('verify ffmpeg', ['ffmpeg', '-version']);
  await runner.run('verify ffprobe', ['ffprobe', '-version']);
  runner.checkReady();
  runner.log('PASS: ffmpeg and ffprobe ready');
}

if (import.meta.main) {
  const launchSeconds = Number(process.argv[2]);
  const cancellation = new AbortController();
  process.on('SIGTERM', () => cancellation.abort());
  process.on('SIGINT', () => cancellation.abort());
  try {
    if (
      process.getuid?.() !== 0 ||
      !Number.isFinite(launchSeconds) ||
      launchSeconds <= 0 ||
      launchSeconds * 1000 > elapsedBootMs()
    )
      throw new Error('root and an original non-future launch stamp required');
    const runner = createPreparation(launchSeconds, cancellation.signal);
    runner.log(
      `runner image ${process.env.ImageOS ?? 'unknown'}/${process.env.ImageVersion ?? 'unknown'}`,
    );
    await prepareFfmpeg(runner);
  } catch (error) {
    console.error(`ffmpeg preparation FAIL: ${String(error)}`);
    // A failed bounded reap must not leave a referenced child handle keeping
    // the supervisor alive. Failure does not assert descendant quiescence.
    process.exit(1);
  }
}
