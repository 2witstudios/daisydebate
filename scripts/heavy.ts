#!/usr/bin/env bun
/**
 * Machine-wide queue for heavy commands: builds, typechecks, test suites,
 * browser e2e, the check and verify gates, and dev servers. Writing code in
 * parallel is fine; running these in parallel is what saturates the
 * machine. Every checkout on the machine shares one slot directory, fixed
 * at /tmp/daisy-heavy-slots so that TMPDIR (per user on macOS, and stripped
 * by turbo) never splits the pool; turbo.json passes HEAVY_ENV through. A
 * run claims a slot before starting its command and waits, queued, while
 * DAISY_HEAVY_CONCURRENCY runs (default 1) already hold one.
 *
 * A run whose ancestor process holds a slot is part of that run (bun check
 * → bun typecheck → turbo → a package's typecheck) and runs inside that
 * slot: it never claims a fresh one in the pool its ancestor holds, so
 * nesting cannot deadlock. The ancestry comes from the process table, not
 * an inherited marker, so turbo's strict env mode cannot strip it and
 * nothing outside the holder's process tree can borrow its slot.
 *
 * Every claim carries a wall-clock deadline (DAISY_HEAVY_TIMEOUT_MINUTES,
 * default 45), dev servers included. At the deadline the holder terminates
 * its command's process tree and releases the slot; a holder that cannot
 * (hung, or killed without cleanup) is terminated by the first queued run
 * once its deadline is a minute past.
 *
 * A claim is an empty file named by slot, pid, start and deadline, so
 * clearing a dead run's claim removes only that run's file, and a crash
 * between create and write cannot leave an unreadable claim. Two runs that
 * claim one slot together both see it, and a run keeps its claim only while
 * no other live run holds that slot.
 *
 *   bun scripts/heavy.ts <command…>
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Held = {
  readonly slot: number;
  readonly pid: number;
  readonly start: number;
  readonly deadline: number;
};
type Env = Readonly<Record<string, string | undefined>>;
type Alive = (pid: number) => boolean;

const DEFAULT_LIMIT = 1;
const DEFAULT_LOCK_DIR = '/tmp/daisy-heavy-slots';
const DEFAULT_TIMEOUT_MINUTES = 45;
/** How long past its deadline a holder may run before a queued run ends it. */
export const OVERDUE_GRACE_MS = 60_000;
/** How long a terminated tree gets between SIGTERM and SIGKILL. */
const KILL_GRACE_MS = 10_000;

/** The settings a run reads; turbo must pass each one through. */
export const HEAVY_ENV = [
  'DAISY_HEAVY_CONCURRENCY',
  'DAISY_HEAVY_LOCK_DIR',
  'DAISY_HEAVY_POLL_MS',
  'DAISY_HEAVY_TIMEOUT_MINUTES',
] as const;

export const lockDir = (env: Env): string =>
  env.DAISY_HEAVY_LOCK_DIR || DEFAULT_LOCK_DIR;

const positive = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export function readLimit(env: Env) {
  const value = Number(env.DAISY_HEAVY_CONCURRENCY);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_LIMIT;
}

/** The wall-clock limit of one heavy run, in milliseconds. */
export const readTimeoutMs = (env: Env): number =>
  Math.round(
    positive(env.DAISY_HEAVY_TIMEOUT_MINUTES, DEFAULT_TIMEOUT_MINUTES) * 60_000,
  );

/**
 * A package script without its queue prefix, so checks that compare the
 * command a script runs see the command, not the queue.
 */
export const unqueued = (script: string): string => script.replace(QUEUED, '');

const QUEUED = /^(?:\w+=\S+ )*bun (?:\.\.\/\.\.\/)?scripts\/heavy\.ts /;

const SLOT_FILE = /^slot-(\d+)-(\d+)-(\d+)-(\d+)\.pid$/;

export const slotFile = (held: Held): string =>
  `slot-${held.slot}-${held.pid}-${held.start}-${held.deadline}.pid`;

/** The claims in a slot directory, read from their names. */
export const parseHeld = (names: readonly string[]): Held[] =>
  names.flatMap((name) => {
    const match = SLOT_FILE.exec(name);
    return match
      ? [
          {
            slot: Number(match[1]),
            pid: Number(match[2]),
            start: Number(match[3]),
            deadline: Number(match[4]),
          },
        ]
      : [];
  });

/** Parent pid by pid, from `ps -A -o pid=,ppid=` output. */
export const parseProcessTable = (text: string): ReadonlyMap<number, number> =>
  new Map(
    text.split('\n').flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)(?:\s+\S+)?\s*$/.exec(line);
      return match ? [[Number(match[1]), Number(match[2])] as const] : [];
    }),
  );

/** Elapsed run time by pid, from `ps -A -o pid=,ppid=,etime=` output. */
export const parseElapsedTable = (text: string): ReadonlyMap<number, number> =>
  new Map(
    text.split('\n').flatMap((line) => {
      const match = /^\s*(\d+)\s+\d+\s+(\S+)\s*$/.exec(line);
      const elapsed = match ? parseElapsed(match[2]) : undefined;
      return match && elapsed !== undefined
        ? [[Number(match[1]), elapsed] as const]
        : [];
    }),
  );

/** `ps` etime, `[[dd-]hh:]mm:ss`, in milliseconds. */
export function parseElapsed(etime: string): number | undefined {
  const match = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(etime);
  if (!match) return undefined;
  const [days, hours, minutes, seconds] = match
    .slice(1)
    .map((part) => Number(part ?? 0));
  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
}

/** etime counts whole seconds, so a claimant may seem to start this late. */
const START_TOLERANCE_MS = 2000;

/**
 * Whether the live process behind a claim's pid is the run that wrote the
 * claim: a claimant starts before it claims, so a process that started
 * after the claim is a stranger that reused a dead run's pid.
 */
export const isClaimant = (
  held: Held,
  elapsedMs: number | undefined,
  now: number,
): boolean =>
  elapsedMs !== undefined && now - elapsedMs <= held.start + START_TOLERANCE_MS;

/** A process's ancestors, nearest first, stopping at a cycle or the root. */
export function ancestors(
  parents: ReadonlyMap<number, number>,
  pid: number,
): number[] {
  const chain: number[] = [];
  for (
    let parent = parents.get(pid);
    parent !== undefined && parent > 0 && !chain.includes(parent);
    parent = parents.get(parent)
  )
    chain.push(parent);
  return chain;
}

/** A process and every process below it, the root first. */
export function processTree(
  parents: ReadonlyMap<number, number>,
  root: number,
): number[] {
  const tree = [root];
  for (let index = 0; index < tree.length; index++)
    for (const [pid, parent] of parents)
      if (parent === tree[index] && !tree.includes(pid)) tree.push(pid);
  return tree;
}

/** The live claim held by one of this run's ancestors, if any. */
export const nestedIn = (
  held: readonly Held[],
  lineage: readonly number[],
  alive: Alive,
): Held | undefined =>
  held.find((h) => lineage.includes(h.pid) && alive(h.pid));

/** Which slot to claim, if any, and which claims belong to dead runs. */
export function claimPlan(
  held: readonly Held[],
  limit: number,
  alive: Alive,
): { readonly claim: number | undefined; readonly stale: readonly Held[] } {
  const stale = held.filter((h) => !alive(h.pid));
  const busy = new Set(held.filter((h) => alive(h.pid)).map((h) => h.slot));
  // The limit is a total of live runs, not a range of slot numbers: runs
  // started under a higher limit still count.
  const claim =
    busy.size >= limit
      ? undefined
      : Array.from({ length: busy.size + 1 }, (_, slot) => slot).find(
          (slot) => !busy.has(slot),
        );
  return { claim, stale };
}

/**
 * How a run is admitted: inside an ancestor's slot, into a free slot, or
 * into the queue. Nesting is decided first, so a holder's descendant never
 * queues behind the slot its own ancestor holds.
 */
export function admission(
  held: readonly Held[],
  lineage: readonly number[],
  limit: number,
  alive: Alive,
):
  | { readonly kind: 'nested'; readonly holder: Held }
  | { readonly kind: 'claim'; readonly slot: number }
  | { readonly kind: 'wait' } {
  const holder = nestedIn(held, lineage, alive);
  if (holder) return { kind: 'nested', holder };
  const { claim } = claimPlan(held, limit, alive);
  return claim === undefined
    ? { kind: 'wait' }
    : { kind: 'claim', slot: claim };
}

/**
 * Whether a fresh claim stands: no other live run holds its slot, and the
 * live claims, this one included, stay within the limit.
 */
export function keepsClaim(
  held: readonly Held[],
  mine: Held,
  alive: Alive,
  limit: number,
): boolean {
  const live = held.filter(
    (other) => alive(other.pid) || other.pid === mine.pid,
  );
  return (
    live.length <= limit &&
    !live.some((other) => other.slot === mine.slot && other.pid !== mine.pid)
  );
}

/** Live claims whose deadline passed more than the grace ago. */
export const overdue = (
  held: readonly Held[],
  now: number,
  alive: Alive,
): Held[] =>
  held.filter((h) => alive(h.pid) && now > h.deadline + OVERDUE_GRACE_MS);

/** Milliseconds as the two largest units: 2h 54m, 3m 5s, 0s. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const parts: [number, string][] = [
    [Math.floor(seconds / 3600), 'h'],
    [Math.floor((seconds % 3600) / 60), 'm'],
    [seconds % 60, 's'],
  ];
  const first = parts.findIndex(([value]) => value > 0);
  if (first === -1) return '0s';
  return parts
    .slice(first, first + 2)
    .filter(([value]) => value > 0)
    .map(([value, unit]) => `${value}${unit}`)
    .join(' ');
}

/** The line a queued run prints, naming each live holder, its command and age. */
export function waitingLine(
  held: readonly Held[],
  alive: Alive,
  limit: number,
  now: number,
  command: (pid: number) => string,
): string {
  const holders = held
    .filter((h) => alive(h.pid))
    .map(
      (h) =>
        `pid ${h.pid} (${command(h.pid)}, running ${formatDuration(now - h.start)}, ends in ${formatDuration(h.deadline - now)})`,
    );
  return `heavy: waiting for ${holders.join('; ')} (DAISY_HEAVY_CONCURRENCY=${limit})\n`;
}

/** The line a holder prints when its wall-clock limit ends its command. */
export const timeoutLine = (command: string, timeoutMs: number): string =>
  `heavy: "${command}" ran past its ${formatDuration(timeoutMs)} wall-clock limit (DAISY_HEAVY_TIMEOUT_MINUTES); terminated its process tree and released the slot\n`;

/** The line a queued run prints when it ends a holder past its deadline. */
export const overdueLine = (held: Held, command: string, now: number): string =>
  `heavy: pid ${held.pid} (${command}) ran ${formatDuration(now - held.deadline)} past its deadline; terminated its process tree and released slot ${held.slot}\n`;

// ------------------------------------------------------------------- edges

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Thrown where `ps` is not installed, as in the slim Docker build image. */
class NoProcessTable extends Error {}

function readProcesses(): string {
  let ps;
  try {
    ps = Bun.spawnSync(['ps', '-A', '-o', 'pid=,ppid=,etime=']);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new NoProcessTable('ps is not installed');
    throw error;
  }
  // Failing loudly beats guessing: a nested run that claimed would deadlock.
  if (ps.exitCode !== 0)
    throw new Error(`heavy: ps exited ${ps.exitCode}; cannot read processes`);
  return ps.stdout.toString();
}

const processTable = () => parseProcessTable(readProcesses());

/**
 * Which claims' pids still belong to their claimants: a dead pid, or a live
 * one reused by a process that started after the claim, holds nothing, so
 * it is cleared and never terminated.
 */
function claimantCheck(held: readonly Held[]): (pid: number) => boolean {
  const elapsed = parseElapsedTable(readProcesses());
  const now = Date.now();
  return (pid) =>
    pid === process.pid ||
    (isAlive(pid) &&
      held
        .filter((h) => h.pid === pid)
        .every((h) => isClaimant(h, elapsed.get(pid), now)));
}

function commandOf(pid: number): string {
  const text = Bun.spawnSync(['ps', '-o', 'command=', '-p', String(pid)])
    .stdout.toString()
    .trim()
    .replace(/^bun \S*scripts\/heavy\.ts /, '');
  return text.length > 100 ? `${text.slice(0, 99)}…` : text || 'unknown';
}

const signal = (pids: readonly number[], name: NodeJS.Signals) => {
  for (const pid of pids)
    try {
      process.kill(pid, name);
    } catch {
      // Already gone.
    }
};

/** SIGTERM a process tree, then SIGKILL whatever outlives the grace. */
async function terminateTree(root: number): Promise<void> {
  const tree = processTree(processTable(), root);
  signal(tree, 'SIGTERM');
  for (
    const until = Date.now() + KILL_GRACE_MS;
    Date.now() < until && tree.some(isAlive);
  )
    await Bun.sleep(200);
  signal(tree.filter(isAlive), 'SIGKILL');
}

/**
 * Creates a claim file exclusively: false when anything, a file or a symlink
 * planted at the predicted name, is already there, so nothing is written
 * through it. Other errors are raised.
 */
export function claimFile(file: string): boolean {
  try {
    writeFileSync(file, '', { flag: 'wx' });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

async function clearDeadAndOverdue(dir: string): Promise<void> {
  const held = parseHeld(readdirSync(dir));
  const alive = claimantCheck(held);
  for (const h of held.filter((h) => !alive(h.pid)))
    rmSync(join(dir, slotFile(h)), { force: true });
  const now = Date.now();
  for (const h of overdue(held, now, alive)) {
    process.stderr.write(overdueLine(h, commandOf(h.pid), now));
    await terminateTree(h.pid);
    rmSync(join(dir, slotFile(h)), { force: true });
  }
}

function tryClaim(
  dir: string,
  limit: number,
  slot: number,
  timeoutMs: number,
): string | undefined {
  const start = Date.now();
  const mine = {
    slot,
    pid: process.pid,
    start,
    deadline: start + timeoutMs,
  };
  const file = join(dir, slotFile(mine));
  if (!claimFile(file)) return undefined;
  const held = parseHeld(readdirSync(dir));
  if (keepsClaim(held, mine, claimantCheck(held), limit)) return file;
  rmSync(file, { force: true }); // another run took this slot too; look again
  return undefined;
}

async function run(
  command: readonly string[],
  timeoutMs: number | undefined,
): Promise<number> {
  const child = Bun.spawn([...command], {
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
    process.on(name, () => child.kill(name));
  let terminated: Promise<void> | undefined;
  const timer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          process.stderr.write(timeoutLine(command.join(' '), timeoutMs));
          terminated = terminateTree(child.pid);
        }, timeoutMs);
  const code = await child.exited;
  clearTimeout(timer);
  if (!terminated) return code;
  await terminated; // the SIGKILL sweep, before the slot is released
  return 124;
}

async function main(command: readonly string[]): Promise<number> {
  let lineage: number[];
  try {
    lineage = ancestors(processTable(), process.pid);
  } catch (error) {
    if (!(error instanceof NoProcessTable)) throw error;
    // Without a process table nesting cannot be told apart, and queueing
    // blind could deadlock; such hosts (the Docker build) run one job.
    process.stderr.write(`heavy: ${error.message}; running unqueued\n`);
    return run(command, undefined);
  }
  return queued(command, lineage);
}

async function queued(
  command: readonly string[],
  lineage: readonly number[],
): Promise<number> {
  const env = process.env;
  const limit = readLimit(env);
  const timeoutMs = readTimeoutMs(env);
  const dir = lockDir(env);
  // Offset by pid so two runs that withdrew from one slot retry apart.
  const pollMs = Number(env.DAISY_HEAVY_POLL_MS ?? 5000) + (process.pid % 97);
  mkdirSync(dir, { recursive: true });
  let announced = '';
  for (;;) {
    await clearDeadAndOverdue(dir);
    const held = parseHeld(readdirSync(dir));
    const alive = claimantCheck(held);
    const admitted = admission(held, lineage, limit, alive);
    // The holder's own deadline bounds a nested run.
    if (admitted.kind === 'nested') return run(command, undefined);
    if (admitted.kind === 'claim') {
      const claimed = tryClaim(dir, limit, admitted.slot, timeoutMs);
      if (claimed)
        try {
          return await run(command, timeoutMs);
        } finally {
          rmSync(claimed, { force: true });
        }
    } else {
      // One line per change of holders, quiet otherwise.
      const holders = held
        .filter((h) => alive(h.pid))
        .map((h) => h.pid)
        .join(',');
      if (holders !== announced) {
        announced = holders;
        process.stderr.write(
          waitingLine(held, alive, limit, Date.now(), commandOf),
        );
      }
    }
    await Bun.sleep(pollMs);
  }
}

if (import.meta.main) {
  const command = process.argv.slice(2);
  if (command.length === 0) {
    process.stderr.write('usage: heavy.ts <command…>\n');
    process.exit(2);
  }
  process.exit(await main(command));
}
