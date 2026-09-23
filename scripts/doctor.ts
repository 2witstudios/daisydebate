import { SQL, RedisClient } from 'bun';
import { readServerConfig } from '@daisy/config';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serviceRefusal, slotMismatches, type Slot } from './slot-model';
import {
  inspectOrphans,
  liveSlotIds,
  openServices,
  resolveCheckout,
} from './slot';

const checkNames = [
  'bun-version',
  'env',
  'postgres',
  'migration-currency',
  'redis',
  'boundaries',
  'slot',
  'slot-orphans',
] as const;

type CheckName = (typeof checkNames)[number];
/** A warning is reported but does not fail the doctor. */
type CheckStatus = 'pass' | 'warn' | 'fail';
export type DoctorCheck = {
  readonly name: CheckName;
  readonly status: CheckStatus;
  readonly detail: string;
};
export type DoctorReport = {
  readonly ok: boolean;
  readonly checks: readonly DoctorCheck[];
};

const root = resolve(import.meta.dir, '..');

export function isMigrationCurrent(
  committedTags: readonly string[],
  appliedTags: readonly string[],
): boolean {
  return (
    committedTags.length === appliedTags.length &&
    committedTags.every((tag, index) => tag === appliedTags[index])
  );
}

export async function readCommittedMigrationHashes(): Promise<
  readonly string[]
> {
  const journal = JSON.parse(
    await readFile(
      resolve(root, 'packages/db/migrations/meta/_journal.json'),
      'utf8',
    ),
  ) as { entries?: readonly { tag: string }[] };

  return Promise.all(
    (journal.entries ?? []).map(async ({ tag }) => {
      const sql = await readFile(
        resolve(root, 'packages/db/migrations', `${tag}.sql`),
        'utf8',
      );
      return createHash('sha256').update(sql).digest('hex');
    }),
  );
}

export function createDoctorReport(
  checks: readonly DoctorCheck[],
): DoctorReport {
  const byName = new Map(checks.map((check) => [check.name, check]));
  const orderedChecks = checkNames.map(
    (name): DoctorCheck =>
      byName.get(name) ?? { name, status: 'fail', detail: 'not checked' },
  );
  return {
    ok: orderedChecks.every((check) => check.status !== 'fail'),
    checks: orderedChecks,
  };
}

export function formatDoctorReport(
  report: DoctorReport,
  json: boolean,
): string {
  if (json) return `${JSON.stringify(report, null, 2)}\n`;
  return [
    `Daisy doctor: ${report.ok ? 'PASS' : 'FAIL'}`,
    ...report.checks.map(
      (check) => `${check.status.toUpperCase()} ${check.name}: ${check.detail}`,
    ),
    '',
  ].join('\n');
}

function pass(name: CheckName, detail: string): DoctorCheck {
  return { name, status: 'pass', detail };
}

function fail(name: CheckName, detail: string): DoctorCheck {
  return { name, status: 'fail', detail };
}

/** Fails when this checkout's .env names another slot's data. */
export function slotCheck(
  slot: Slot,
  env: Readonly<Record<string, string | undefined>>,
): DoctorCheck {
  const mismatches = slotMismatches(slot, env);
  return mismatches.length === 0
    ? pass('slot', slot.id)
    : fail(
        'slot',
        `slot ${slot.id}: ${mismatches.join('; ')} (run bun slot:up)`,
      );
}

export function orphanCheck(ids: readonly string[]): DoctorCheck {
  return ids.length === 0
    ? pass('slot-orphans', 'none')
    : {
        name: 'slot-orphans',
        status: 'warn',
        detail: `orphaned slots: ${ids.join(', ')} (run bun slot:prune)`,
      };
}

async function checkSlots(): Promise<readonly DoctorCheck[]> {
  let checkout;
  try {
    checkout = await resolveCheckout(root);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unresolved';
    return [fail('slot', detail), fail('slot-orphans', 'slot unresolved')];
  }
  const slot = slotCheck(checkout.slot, process.env);
  // The slot tooling's own refusals are shown as they are; connection
  // failures stay generic so no driver error text reaches the report.
  const refusal = serviceRefusal(process.env);
  if (refusal) return [slot, fail('slot-orphans', refusal)];
  let liveIds: readonly string[];
  try {
    liveIds = await liveSlotIds(checkout);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'worktrees unread';
    return [slot, fail('slot-orphans', detail)];
  }
  let services;
  try {
    services = openServices(process.env);
    return [slot, orphanCheck((await inspectOrphans(services, liveIds)).ids)];
  } catch {
    return [slot, fail('slot-orphans', 'services unavailable')];
  } finally {
    await services?.close().catch(() => undefined);
  }
}

async function checkBunVersion(): Promise<DoctorCheck> {
  try {
    const expected = (
      await Bun.file(resolve(root, '.bun-version')).text()
    ).trim();
    return Bun.version === expected
      ? pass('bun-version', Bun.version)
      : fail('bun-version', `expected ${expected}, got ${Bun.version}`);
  } catch {
    return fail('bun-version', 'version file unavailable');
  }
}

function checkEnvironment(): DoctorCheck {
  try {
    readServerConfig(process.env);
    return pass('env', 'valid');
  } catch (error) {
    return fail('env', error instanceof Error ? error.message : 'invalid');
  }
}

async function checkPostgres(url: string | undefined): Promise<DoctorCheck> {
  if (!url) return fail('postgres', 'DATABASE_URL unavailable');
  let client: SQL | undefined;
  try {
    client = new SQL(url, { max: 1, connectionTimeout: 3 });
    await client`select 1`;
    return pass('postgres', 'reachable');
  } catch {
    return fail('postgres', 'unreachable');
  } finally {
    await client?.close({ timeout: 5 });
  }
}

async function checkMigrationCurrency(
  url: string | undefined,
): Promise<DoctorCheck> {
  if (!url) return fail('migration-currency', 'DATABASE_URL unavailable');
  let client: SQL | undefined;
  try {
    const committedHashes = await readCommittedMigrationHashes();
    client = new SQL(url, { max: 1, connectionTimeout: 3 });
    const rows = await client`
      select hash
      from drizzle.__drizzle_migrations
      order by created_at asc
    `;
    const appliedHashes = rows.map((row) => row.hash);
    if (
      !appliedHashes.every((hash): hash is string => typeof hash === 'string')
    )
      return fail(
        'migration-currency',
        'migration drift: non-string hash recorded',
      );
    if (!isMigrationCurrent(committedHashes, appliedHashes)) {
      const firstDivergence = committedHashes.findIndex(
        (hash, index) => appliedHashes[index] !== hash,
      );
      return fail(
        'migration-currency',
        firstDivergence === -1
          ? `migration drift: ${appliedHashes.length} applied migrations against ${committedHashes.length} committed migrations`
          : `migration drift: first divergence at migration ${firstDivergence + 1} of ${committedHashes.length}`,
      );
    }
    return pass(
      'migration-currency',
      `${committedHashes.length} migration${committedHashes.length === 1 ? '' : 's'}`,
    );
  } catch {
    return fail('migration-currency', 'migration table unavailable');
  } finally {
    await client?.close({ timeout: 5 });
  }
}

async function checkRedis(url: string | undefined): Promise<DoctorCheck> {
  if (!url) return fail('redis', 'REDIS_URL unavailable');
  let client: RedisClient | undefined;
  try {
    client = new RedisClient(url);
    await client.connect();
    return (await client.ping()) === 'PONG'
      ? pass('redis', 'PONG')
      : fail('redis', 'unexpected response');
  } catch {
    return fail('redis', 'unreachable');
  } finally {
    client?.close();
  }
}

async function checkBoundaries(): Promise<DoctorCheck> {
  const process = Bun.spawn(['bun', 'scripts/check-boundaries.ts'], {
    cwd: root,
    stdout: 'ignore',
    stderr: 'ignore',
  });
  return (await process.exited) === 0
    ? pass('boundaries', 'verified')
    : fail('boundaries', 'failed');
}

export async function runDoctor(): Promise<DoctorReport> {
  const env = checkEnvironment();
  const [bunVersion, postgres, migrations, redis, boundaries, slots] =
    await Promise.all([
      checkBunVersion(),
      checkPostgres(process.env.DATABASE_URL),
      checkMigrationCurrency(process.env.DATABASE_URL),
      checkRedis(process.env.REDIS_URL),
      checkBoundaries(),
      checkSlots(),
    ]);
  return createDoctorReport([
    bunVersion,
    env,
    postgres,
    migrations,
    redis,
    boundaries,
    ...slots,
  ]);
}

if (import.meta.main) {
  const report = await runDoctor();
  process.stdout.write(
    formatDoctorReport(report, process.argv.includes('--json')),
  );
  process.exitCode = report.ok ? 0 : 1;
}
