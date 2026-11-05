import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import type { FlagChange } from '@daisy/protocol/flags';
import type { FlagCommandInput } from '../src/flags-command';
import { flagOperations } from '../src/flags-operations';
import { withFixture, type Fixture } from './constraint-helpers';

const { databaseUrl } = requireTestServices(process.env);
export function withFlags(
  run: (input: {
    fixture: Fixture;
    key: string;
    userId: string;
    actorId: string;
    database: ReturnType<typeof drizzle>;
    store: ReturnType<typeof flagOperations>;
  }) => Promise<void>,
) {
  return withFixture(databaseUrl, async (fixture) => {
    const key = `test-${createId()}`;
    const userId = await fixture.user();
    const actorId = await fixture.actor(userId);
    const database = drizzle({ client: fixture.sql });
    try {
      await run({
        fixture,
        key,
        userId,
        actorId,
        database,
        store: flagOperations({ database }),
      });
    } finally {
      await fixture.sql`delete from flag_change_events where key = ${key}`;
      await fixture.sql`delete from operator_command_receipts where action in ('flag.state.update', 'flag.override.update') and result ->> 'key' = ${key}`;
      await fixture.sql`delete from flag_account_overrides where key = ${key}`;
      await fixture.sql`delete from release_flags where key = ${key}`;
    }
  });
}

/** Only a revision policy fixture; web integration exercises the actual catalogue policy. */
export function flagCommand(
  key: string,
  expectedRevision: number,
  change: FlagChange = { action: 'flag.state.update', state: 'enabled' },
  overrides: Partial<FlagCommandInput> = {},
): FlagCommandInput {
  return {
    key,
    commandId: createId(),
    serviceId: 'daisy-admin',
    operatorRef: 'o'.repeat(24),
    requestDigest: 'a'.repeat(64),
    adminAuditHead: 'b'.repeat(64),
    change,
    nextId: createId,
    live: () => true,
    authorize: () => true,
    decide: (revision) =>
      revision === expectedRevision
        ? { kind: 'apply', revision: revision + 1 }
        : { kind: 'refused', reason: 'CONFLICT' },
    ...overrides,
  };
}
export function barrier() {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release };
}
/** Wait for the actual lock wait, with a bounded failure rather than a scheduling guess. */
export async function waitingForFlags(fixture: Fixture) {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const [row] = await fixture.sql`select count(*)::integer as n from pg_locks
      where locktype = 'advisory' and classid = 59118 and objid = 1 and not granted`;
    if (row?.n > 0) return;
    await Bun.sleep(5);
  }
  throw new Error('Flags lock waiter did not arrive');
}
