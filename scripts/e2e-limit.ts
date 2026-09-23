#!/usr/bin/env bun
/**
 * Machine-wide limit on concurrent browser e2e runs (ADR 0035). Every
 * checkout on the machine shares one slot directory, fixed at
 * /tmp/daisy-e2e-slots so that TMPDIR (per user on macOS, and stripped by
 * turbo) never splits the pool; turbo.json passes E2E_ENV through. A run
 * claims a slot file atomically (O_EXCL) before starting Playwright and
 * waits, queued, while DAISY_E2E_CONCURRENCY runs (default 2) already hold
 * one. Slots of runs whose process is gone are cleared.
 *
 *   bun scripts/e2e-limit.ts <command…>
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

type Held = { readonly slot: number; readonly pid: number };

const DEFAULT_LIMIT = 2;
const DEFAULT_LOCK_DIR = '/tmp/daisy-e2e-slots';

/** The settings a run reads; turbo must pass each one through. */
export const E2E_ENV = [
  'DAISY_E2E_CONCURRENCY',
  'DAISY_E2E_LOCK_DIR',
  'DAISY_E2E_POLL_MS',
] as const;

export const lockDir = (
  env: Readonly<Record<string, string | undefined>>,
): string => env.DAISY_E2E_LOCK_DIR || DEFAULT_LOCK_DIR;

export function readLimit(env: Readonly<Record<string, string | undefined>>) {
  const value = Number(env.DAISY_E2E_CONCURRENCY);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_LIMIT;
}

/** Which slot to claim, if any, and which held slots belong to dead runs. */
export function claimPlan(
  held: readonly Held[],
  limit: number,
  alive: (pid: number) => boolean,
): { readonly claim: number | undefined; readonly stale: readonly number[] } {
  const stale = held.filter((h) => !alive(h.pid)).map((h) => h.slot);
  const busy = new Set(held.filter((h) => alive(h.pid)).map((h) => h.slot));
  const claim = Array.from({ length: limit }, (_, slot) => slot).find(
    (slot) => !busy.has(slot),
  );
  return { claim, stale };
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

function readHeld(dir: string): Held[] {
  return readdirSync(dir).flatMap((name) => {
    const slot = /^slot-(\d+)\.pid$/.exec(name)?.[1];
    if (slot === undefined) return [];
    let text: string;
    try {
      text = readFileSync(join(dir, name), 'utf8').trim();
    } catch {
      return []; // released between listing and reading
    }
    // An empty file is a claim still being written: count it as held.
    const pid = text === '' ? process.pid : Number(text);
    return Number.isInteger(pid) ? [{ slot: Number(slot), pid }] : [];
  });
}

function tryClaim(dir: string, limit: number): string | undefined {
  const plan = claimPlan(readHeld(dir), limit, isAlive);
  for (const slot of plan.stale)
    rmSync(join(dir, `slot-${slot}.pid`), { force: true });
  if (plan.claim === undefined) return undefined;
  const file = join(dir, `slot-${plan.claim}.pid`);
  try {
    writeFileSync(file, String(process.pid), { flag: 'wx' });
    return file;
  } catch {
    return undefined; // another run claimed it first; look again
  }
}

async function main(command: readonly string[]): Promise<number> {
  const env = process.env;
  const limit = readLimit(env);
  const dir = lockDir(env);
  const pollMs = Number(env.DAISY_E2E_POLL_MS ?? 5000);
  mkdirSync(dir, { recursive: true });
  let claimed = tryClaim(dir, limit);
  if (!claimed)
    process.stderr.write(
      `e2e: ${limit} run(s) already hold every slot (DAISY_E2E_CONCURRENCY=${limit}); queued\n`,
    );
  while (!claimed) {
    await Bun.sleep(pollMs);
    claimed = tryClaim(dir, limit);
  }
  const release = () => rmSync(claimed as string, { force: true });
  const child = Bun.spawn([...command], {
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
    process.on(signal, () => child.kill(signal));
  try {
    return await child.exited;
  } finally {
    release();
  }
}

if (import.meta.main) {
  const command = process.argv.slice(2);
  if (command.length === 0) {
    process.stderr.write('usage: e2e-limit.ts <command…>\n');
    process.exit(2);
  }
  process.exit(await main(command));
}
