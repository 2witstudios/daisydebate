import { asc } from 'drizzle-orm';
import {
  createOperatorApiStub,
  type StubAccount,
} from '../e2e/support/operator-api-stub';
import { systemRandom } from '../src/auth/secrets';
import {
  submitBetaAccess,
  type CommandDeps,
} from '../src/features/accounts/commands';
import {
  createOperatorClient,
  type OperatorFetch,
} from '../src/features/operator-client/client';
import { bunOperatorCrypto } from '../src/features/operator-client/bun-crypto';
import { auditEvents, operators, pendingCommands } from '../src/db/schema';
import { testDeps, type suiteDatabase } from './admin.test-support';

/**
 * The command suites' shared fixture: an owner row, a stub that verifies
 * every signature, and a client for it (ADR 0077 amendment).
 */
type Db = ReturnType<typeof suiteDatabase>['db'];

const keyId = 'admin1';
const key = new Uint8Array(32).fill(5);
const audience = 'daisy-web:local';
export const userId = 'p'.repeat(24);
export const pending = (): StubAccount => ({
  userId,
  username: 'pending-player',
  accessState: 'pending',
  accessRevision: 1,
  requestedAt: '2026-10-25T09:00:00.123456Z',
  decidedAt: null,
});

/** An owner row, a stub that verifies every signature, and a client for it. */
export async function setupCommands(
  db: Db,
  {
    observe = async () => {},
    accounts = [pending()],
    wrapFetch = (fetch) => fetch,
  }: {
    readonly observe?: (body: unknown) => Promise<void>;
    readonly accounts?: readonly StubAccount[];
    readonly wrapFetch?: (fetch: OperatorFetch) => OperatorFetch;
  } = {},
) {
  const base = testDeps(db);
  const stub = createOperatorApiStub({
    audience,
    keyId,
    key,
    nowMs: () => Date.parse(base.clock.now()),
    accounts,
  });
  const client = createOperatorClient({
    config: { baseUrl: 'http://operator.test', keyId, key, audience },
    crypto: bunOperatorCrypto,
    clock: base.clock,
    random: systemRandom,
    fetch: wrapFetch(async (url, init) => {
      if (init.body) await observe(JSON.parse(String(init.body)));
      return stub.handle(new Request(url, init));
    }),
    timeoutMs: 5_000,
  });
  const operatorId = base.ids.next();
  await db.insert(operators).values({
    id: operatorId,
    displayName: 'owner',
    role: 'owner',
    createdAt: new Date(base.clock.now()),
  });
  const deps: CommandDeps = {
    db,
    clock: base.clock,
    ids: base.ids,
    client,
  };
  const approve = (expectedRevision = 1) =>
    submitBetaAccess(deps, {
      operatorId,
      targetUserId: userId,
      desiredState: 'approved',
      expectedRevision,
    });
  return { deps, stub, operatorId, approve };
}

export const kinds = async (db: Db) =>
  (await db.select().from(auditEvents).orderBy(asc(auditEvents.seq))).map(
    ({ kind, outcome, detail }) =>
      [kind, outcome ?? '', detail ?? ''].join(':'),
  );
export const openCount = async (db: Db) =>
  (await db.select().from(pendingCommands)).filter(
    ({ resolvedAt }) => resolvedAt === null,
  ).length;
