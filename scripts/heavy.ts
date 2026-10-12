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
 * → bun typecheck → turbo → a package's typecheck) and runs without
 * claiming, so nesting never deadlocks. The ancestry comes from the process
 * table, not an inherited marker, so turbo's strict env mode cannot strip
 * it and nothing outside the holder's process tree can borrow its slot.
 *
 * A claim is an empty file named by slot and pid, so clearing a dead run's
 * claim removes only that run's file, and a crash between create and write
 * cannot leave an unreadable claim. Two runs that claim one slot together
 * both see it, and a run keeps its claim only while no other live run holds
 * that slot.
 *
 *   bun scripts/heavy.ts <command…>
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Held = { readonly slot: number; readonly pid: number };
type Env = Readonly<Record<string, string | undefined>>;

const DEFAULT_LIMIT = 1;
const DEFAULT_LOCK_DIR = '/tmp/daisy-heavy-slots';

/** The settings a run reads; turbo must pass each one through. */
export const HEAVY_ENV = [
  'DAISY_HEAVY_CONCURRENCY',
  'DAISY_HEAVY_LOCK_DIR',
  'DAISY_HEAVY_POLL_MS',
] as const;

export const lockDir = (env: Env): string =>
  env.DAISY_HEAVY_LOCK_DIR || DEFAULT_LOCK_DIR;

export function readLimit(env: Env) {
  const value = Number(env.DAISY_HEAVY_CONCURRENCY);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_LIMIT;
}

const SLOT_FILE = /^slot-(\d+)-(\d+)\.pid$/;

const slotFile = (held: Held): string => `slot-${held.slot}-${held.pid}.pid`;

/** The claims in a slot directory, read from their names. */
export const parseHeld = (names: readonly string[]): Held[] =>
  names.flatMap((name) => {
    const match = SLOT_FILE.exec(name);
    return match ? [{ slot: Number(match[1]), pid: Number(match[2]) }] : [];
  });

/**
 * A package script without its queue prefix, so checks that compare the
 * command a script runs see the command, not the queue.
 */
export const unqueued = (script: string): string => script.replace(QUEUED, '');

const QUEUED = /^(?:\w+=\S+ )*bun (?:\.\.\/\.\.\/)?scripts\/heavy\.ts /;

/** Parent pid by pid, from `ps -A -o pid=,ppid=` output. */
export const parseProcessTable = (text: string): ReadonlyMap<number, number> =>
  new Map(
    text.split('\n').flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
      return match ? [[Number(match[1]), Number(match[2])] as const] : [];
    }),
  );

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

/** The live claim held by one of this run's ancestors, if any. */
export const nestedIn = (
  held: readonly Held[],
  lineage: readonly number[],
  alive: (pid: number) => boolean,
): Held | undefined =>
  held.find((h) => lineage.includes(h.pid) && alive(h.pid));

/** Which slot to claim, if any, and which claims belong to dead runs. */
export function claimPlan(
  held: readonly Held[],
  limit: number,
  alive: (pid: number) => boolean,
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
 * Whether a fresh claim stands: no other live run holds its slot, and the
 * live claims, this one included, stay within the limit.
 */
export function keepsClaim(
  held: readonly Held[],
  mine: Held,
  alive: (pid: number) => boolean,
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

/** The one line a queued run prints, naming the runs it waits for. */
export function waitingLine(
  held: readonly Held[],
  alive: (pid: number) => boolean,
  limit: number,
): string {
  const pids = held.filter((h) => alive(h.pid)).map((h) => h.pid);
  return `heavy: waiting for pid ${pids.join(', ')} (DAISY_HEAVY_CONCURRENCY=${limit})\n`;
}

// ------------------------------------------------------------------- edges

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function lineage(): number[] {
  const ps = Bun.spawnSync(['ps', '-A', '-o', 'pid=,ppid=']);
  // Failing loudly beats guessing: a nested run that claimed would deadlock.
  if (ps.exitCode !== 0)
    throw new Error(`heavy: ps exited ${ps.exitCode}; cannot read ancestry`);
  return ancestors(parseProcessTable(ps.stdout.toString()), process.pid);
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

function tryClaim(dir: string, limit: number): string | undefined {
  const plan = claimPlan(parseHeld(readdirSync(dir)), limit, isAlive);
  for (const held of plan.stale)
    rmSync(join(dir, slotFile(held)), { force: true });
  if (plan.claim === undefined) return undefined;
  const mine = { slot: plan.claim, pid: process.pid };
  const file = join(dir, slotFile(mine));
  if (!claimFile(file)) return undefined;
  if (keepsClaim(parseHeld(readdirSync(dir)), mine, isAlive, limit))
    return file;
  rmSync(file, { force: true }); // another run took this slot too; look again
  return undefined;
}

async function run(command: readonly string[]): Promise<number> {
  const child = Bun.spawn([...command], {
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
    process.on(signal, () => child.kill(signal));
  return child.exited;
}

async function main(command: readonly string[]): Promise<number> {
  const env = process.env;
  const limit = readLimit(env);
  const dir = lockDir(env);
  // Offset by pid so two runs that withdrew from one slot retry apart.
  const pollMs = Number(env.DAISY_HEAVY_POLL_MS ?? 5000) + (process.pid % 97);
  mkdirSync(dir, { recursive: true });
  if (nestedIn(parseHeld(readdirSync(dir)), lineage(), isAlive))
    return run(command);
  let claimed = tryClaim(dir, limit);
  if (!claimed)
    process.stderr.write(
      waitingLine(parseHeld(readdirSync(dir)), isAlive, limit),
    );
  while (!claimed) {
    await Bun.sleep(pollMs);
    claimed = tryClaim(dir, limit);
  }
  try {
    return await run(command);
  } finally {
    rmSync(claimed, { force: true });
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
