#!/usr/bin/env bun
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

/** Linux boot-relative elapsed time, shared with the workflow launch stamp. */
const elapsedBootMs = () =>
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
  // apt's PTY mode calls setsid before mutating dpkg, escaping our group.
  '-o',
  'Dpkg::Use-Pty=0',
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

/**
 * The warm cache (docs/development/testing.md): apt's signature-verified
 * lists and the exact .deb set one successful run used, restored by the
 * workflow into a runner-owned directory. Lists are only reused on the exact
 * runner image that produced them; .debs from any image prefill apt's
 * archive after each is verified against the current index's SHA256 (apt
 * itself accepts a cached archive on its size alone).
 */
export const stagePaths = (stage: string) => ({
  archives: `${stage}/archives`,
  lists: `${stage}/lists`,
  image: `${stage}/image`,
});

export const runnerImage = (env: Record<string, string | undefined>) =>
  `${env.ImageOS ?? 'unknown'}/${env.ImageVersion ?? 'unknown'}`;

/** A cache entry may supply lists only for the image that wrote them. */
export const listsReusable = (stagedImage: string | undefined, image: string) =>
  stagedImage !== undefined &&
  stagedImage.trim() === image &&
  !image.includes('unknown');

/**
 * The runner's mirror list leads with a cloud-regional archive
 * (azure.archive.ubuntu.com, then us-east-2.ec2.archive.ubuntu.com from
 * 2026-11), which only fails over on errors, never on a slow mirror. Any
 * regional host under archive.ubuntu.com becomes the primary archive.
 */
export const regionalMirrorRewrite =
  's#://[A-Za-z0-9.-]+\\.archive\\.ubuntu\\.com/#://archive.ubuntu.com/#g';

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export const prefillCommand = (stage: string, withLists: boolean) => {
  const paths = stagePaths(stage);
  return [
    'sh',
    '-ec',
    [
      `if [ -d ${quote(paths.archives)} ]; then find ${quote(paths.archives)} -maxdepth 1 -name '*.deb' -exec cp {} /var/cache/apt/archives/ \\; ; fi`,
      withLists ? `cp -R ${quote(paths.lists)}/. /var/lib/apt/lists/` : 'true',
      'echo "prefilled $(find /var/cache/apt/archives -maxdepth 1 -name \'*.deb\' | wc -l) archives"',
    ].join('\n'),
  ];
};

/**
 * apt reuses an archive already in /var/cache/apt/archives when its size
 * matches the index and never hashes it (apt 2.8 pkgAcqArchive). So every
 * archive is checked against the SHA256 the current lists give for its exact
 * package and version, and anything else is deleted before apt can use it.
 * Exit 0 either way: a deleted archive is only fetched again (or, offline,
 * fails the readiness check).
 */
export const verifyArchivesCommand = () => [
  'sh',
  '-ec',
  [
    'kept=0; removed=0',
    'for deb in /var/cache/apt/archives/*.deb; do',
    '  [ -f "$deb" ] || continue',
    // Under sh -e an unreadable archive must not end the loop: it reads as
    // no package, matches nothing in the index and is deleted.
    '  package=$(dpkg-deb -f "$deb" Package 2>/dev/null) || package=""',
    '  version=$(dpkg-deb -f "$deb" Version 2>/dev/null) || version=""',
    '  actual=$(sha256sum "$deb" | cut -d " " -f 1)',
    `  if apt-cache show "$package=$version" 2>/dev/null | grep -qx "SHA256: $actual"; then kept=$((kept + 1)); else rm -f "$deb"; removed=$((removed + 1)); fi`,
    'done',
    'echo "archives verified against the index: $kept kept, $removed removed"',
  ].join('\n'),
];

/**
 * Exit 0 only when the current lists resolve ffmpeg and every archive the
 * install needs is already present: --print-uris prints exactly the files
 * apt would still download, and runs no dpkg.
 */
export const offlineCheckCommand = () => [
  'sh',
  '-ec',
  `missing=$(${['apt-get', '-o', 'Dpkg::Use-Pty=0', 'install', '-qq', '--print-uris', '--no-install-recommends', 'ffmpeg'].join(' ')})\nif [ -n "$missing" ]; then echo "$missing" | wc -l | xargs echo "archives still to download:"; exit 1; fi`,
];

export const dropStageCommand = (stage: string) => ['rm', '-rf', '--', stage];

/**
 * Copies apt's archive aside before dpkg runs: an image whose apt hook cleans
 * the archive after installation (Ubuntu's docker-clean) still leaves a set.
 */
export const holdArchivesCommand = (stage: string) => {
  const next = stagePaths(`${stage}.next`);
  return [
    'sh',
    '-ec',
    [
      `rm -rf ${quote(`${stage}.next`)}`,
      `mkdir -p ${quote(next.archives)}`,
      `find /var/cache/apt/archives -maxdepth 1 -name '*.deb' -exec cp {} ${quote(next.archives)}/ \\;`,
    ].join('\n'),
  ];
};

/** After a verified install: keep what was installed, with its lists. */
export const refreshStageCommand = (
  stage: string,
  image: string,
  owner: string,
) => {
  const next = stagePaths(`${stage}.next`);
  return [
    'sh',
    '-ec',
    [
      // Only the versions now installed, so older images' .debs do not pile up.
      `for deb in ${quote(next.archives)}/*.deb; do [ -f "$deb" ] || continue; package=$(dpkg-deb -f "$deb" Package 2>/dev/null) || package=""; version=$(dpkg-deb -f "$deb" Version 2>/dev/null) || version=""; if [ "$(dpkg-query -W -f='\${Version}' "$package" 2>/dev/null || true)" != "$version" ]; then rm "$deb"; fi; done`,
      `mkdir -p ${quote(next.lists)}`,
      `find /var/lib/apt/lists -maxdepth 1 -type f ! -name lock -exec cp {} ${quote(next.lists)}/ \\;`,
      // Written last: lists are reused only beside it.
      `printf '%s\\n' ${quote(image)} > ${quote(next.image)}`,
      `rm -rf ${quote(stage)}`,
      `mv ${quote(`${stage}.next`)} ${quote(stage)}`,
      `chown -R ${quote(owner)} ${quote(stage)}`,
      `echo "staged $(ls ${quote(stagePaths(stage).archives)} | wc -l) archives, $(du -sh ${quote(stage)} | cut -f1)"`,
    ].join('\n'),
  ];
};

/** Zombies cannot perform work or hold package locks; their parent reaps them. */
function liveGroupMembers(group: number) {
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

function createPreparation(launchSeconds: number, cancellation: AbortSignal) {
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

type Cache = { stage: string; image: string; owner: string };

/**
 * A cache phase whose failure costs only the next run's warm start. Unproven
 * group cleanup still stops preparation: no phase follows a possible survivor.
 */
async function optional(
  runner: ReturnType<typeof createPreparation>,
  phase: string,
  command: readonly string[],
) {
  try {
    await runner.run(phase, command);
    return true;
  } catch (error) {
    if (error instanceof Error && error.cause === 'cleanup-unproven')
      throw error;
    runner.log(`${phase} skipped: ${String(error)}`);
    return false;
  }
}

/** True when the restored cache lets installation run with no network. */
async function restoreFromCache(
  runner: ReturnType<typeof createPreparation>,
  cache: Cache,
) {
  const imageFile = stagePaths(cache.stage).image;
  const staged = existsSync(imageFile)
    ? readFileSync(imageFile, 'utf8')
    : undefined;
  const withLists = listsReusable(staged, cache.image);
  runner.log(
    `cache: staged image ${staged?.trim() ?? 'none'}; lists ${withLists ? 'reused' : 'not reused'}`,
  );
  // A failed prefill only means acquiring as on a cold run.
  const prefilled = await optional(
    runner,
    'prefill from cache',
    prefillCommand(cache.stage, withLists),
  );
  if (!prefilled || !withLists) return false;
  try {
    await runner.run('verify cached archives', verifyArchivesCommand());
    await runner.run('offline readiness', offlineCheckCommand());
    return true;
  } catch (error) {
    runner.log(String(error));
    if (!(error instanceof Error) || error.cause !== 'acquisition-failure')
      throw error;
    return false;
  }
}

async function prepareFfmpeg(
  runner: ReturnType<typeof createPreparation>,
  cache: Cache | undefined,
) {
  const offline = cache ? await restoreFromCache(runner, cache) : false;
  // The workflow saves the stage only beside an image file (staged=true). A
  // restored stage this run will not reuse goes now, so a failed or skipped
  // refresh leaves nothing to save under this image's exact key.
  if (cache && !offline)
    await optional(
      runner,
      'drop restored stage',
      dropStageCommand(cache.stage),
    );
  if (!offline) {
    await acquire(runner);
    if (cache)
      await optional(runner, 'hold archives', holdArchivesCommand(cache.stage));
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
  // A cold run leaves its verified lists and .debs for the workflow to save.
  // ffmpeg is ready either way: a failed stage only costs the next run its
  // offline path, because lists are reused only beside a written image file.
  if (cache && !offline)
    await optional(
      runner,
      'stage cache',
      refreshStageCommand(cache.stage, cache.image, cache.owner),
    );
  // A cache failure is not fatal; cancellation or a spent budget still is.
  runner.checkReady();
  runner.log(
    `PASS: ffmpeg and ffprobe ready (${offline ? 'offline from cache' : 'acquired'})`,
  );
}

async function acquire(runner: ReturnType<typeof createPreparation>) {
  await runner.run('configured package sources', [
    'sh',
    '-ec',
    `for file in ${sourceFiles}; do if [ -f "$file" ]; then echo "--- $file"; cat "$file"; fi; done`,
  ]);
  for (const attempt of [1, 2]) {
    const end = Math.min(runner.deadline, elapsedBootMs() + 80_000);
    try {
      const [update, download] = acquisitionCommands();
      await runner.run(`update attempt ${attempt}`, update!, end);
      // Against the lists just fetched, before download-only reuses anything.
      await runner.run(
        `verify archives attempt ${attempt}`,
        verifyArchivesCommand(),
        end,
      );
      await runner.run(`download attempt ${attempt}`, download!, end);
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
        `regionalMirror=${quote(regionalMirrorRewrite)}\n` +
          `for file in ${sourceFiles}; do if [ -f "$file" ]; then sed -E -i "$regionalMirror" "$file"; fi; done`,
      ]);
      await runner.run('recovered package sources', [
        'sh',
        '-ec',
        `for file in ${sourceFiles}; do if [ -f "$file" ]; then echo "--- $file"; cat "$file"; fi; done`,
      ]);
    }
  }
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
    const image = runnerImage(process.env);
    runner.log(`runner image ${image}`);
    // Optional: the runner-owned cache directory the workflow restores and saves.
    const stage = process.argv[3];
    const owner = `${process.env.SUDO_UID ?? '0'}:${process.env.SUDO_GID ?? '0'}`;
    await prepareFfmpeg(runner, stage ? { stage, image, owner } : undefined);
  } catch (error) {
    console.error(`ffmpeg preparation FAIL: ${String(error)}`);
    // A failed bounded reap must not leave a referenced child handle keeping
    // the supervisor alive. Failure does not assert descendant quiescence.
    process.exit(1);
  }
}
