import { requireTestServices } from '@daisy/config';
import { asc, eq } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createOperatorApiStub,
  type StubAccount,
} from '../e2e/support/operator-api-stub';
import { systemRandom } from '../src/auth/secrets';
import {
  reconcileOpenCommands,
  submitBetaAccess,
  type CommandDeps,
} from '../src/features/accounts/commands';
import { createOperatorClient } from '../src/features/operator-client/client';
import { nodeOperatorCrypto } from '../src/features/operator-client/node-crypto';
import { auditEvents, operators, pendingCommands } from '../src/db/schema';
import { suiteDatabase, testDeps } from './admin.test-support';

requireTestServices(process.env);
setupRitewayBun();
const { db } = suiteDatabase();

const keyId = 'admin1';
const key = new Uint8Array(32).fill(5);
const audience = 'daisy-web:local';
const userId = 'p'.repeat(24);
const pending = (): StubAccount => ({
  userId,
  username: 'pending-player',
  accessState: 'pending',
  accessRevision: 1,
  requestedAt: '2026-10-25T09:00:00.000Z',
  decidedAt: null,
});

/** An owner row, a stub that verifies every signature, and a client for it. */
async function setup(
  observe: (body: unknown) => Promise<void> = async () => {},
) {
  const base = testDeps(db);
  const stub = createOperatorApiStub({
    audience,
    keyId,
    key,
    nowMs: () => Date.parse(base.clock.now()),
    accounts: [pending()],
  });
  const client = createOperatorClient({
    config: { baseUrl: 'http://operator.test', keyId, key, audience },
    crypto: nodeOperatorCrypto,
    clock: base.clock,
    random: systemRandom,
    fetch: async (url, init) => {
      if (init.body) await observe(JSON.parse(String(init.body)));
      return stub.handle(new Request(url, init));
    },
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

const kinds = async () =>
  (await db.select().from(auditEvents).orderBy(asc(auditEvents.seq))).map(
    ({ kind, outcome, detail }) =>
      [kind, outcome ?? '', detail ?? ''].join(':'),
  );
const openCount = async () =>
  (await db.select().from(pendingCommands)).filter(
    ({ resolvedAt }) => resolvedAt === null,
  ).length;

test('the intent is durable before the command is sent', async () => {
  const seen: unknown[] = [];
  const { approve } = await setup(async (body) => {
    const [intent] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.kind, 'command.intent'));
    const [open] = await db.select().from(pendingCommands);
    seen.push({
      anchored:
        intent?.hash === (body as { adminAuditHead: string }).adminAuditHead,
      sameId:
        open?.commandId === (body as { commandId: string }).commandId &&
        intent?.commandId === open?.commandId,
      open: open?.resolvedAt === null,
    });
  });
  const view = await approve();
  assert({
    given: 'an approval',
    should:
      'send only after the pending command and its intent exist, anchored to the head after the intent',
    actual: [seen, view, await kinds(), await openCount()],
    expected: [
      [{ anchored: true, sameId: true, open: true }],
      { notice: 'changed', mail: 'queued' },
      ['command.intent::approved', 'command.outcome:changed:mail_queued'],
      0,
    ],
  });
});

test('a response lost after the change applied', async () => {
  const { deps, stub, operatorId, approve } = await setup();
  stub.lose('lose-after-apply');
  const view = await approve();
  const afterLoss = [await kinds(), await openCount()];
  const reconciled = await reconcileOpenCommands(deps, operatorId);
  assert({
    given: 'an approval whose response never arrived, then a reconciliation',
    should:
      'record unknown and keep it open, then read the stored result back by the same command id',
    actual: [
      view,
      afterLoss,
      reconciled,
      await kinds(),
      await openCount(),
      stub.received.map(({ route }) => route),
      stub.accounts.get(userId)?.accessState,
    ],
    expected: [
      { notice: 'unknown', mail: null },
      [['command.intent::approved', 'command.outcome:unknown:'], 1],
      { settled: 1, open: 0 },
      [
        'command.intent::approved',
        'command.outcome:unknown:',
        'command.reconciled:changed:mail_queued',
      ],
      0,
      ['setBetaAccess', 'readCommand'],
      'approved',
    ],
  });
});

test('a command lost before it arrived', async () => {
  const { deps, stub, operatorId, approve } = await setup();
  stub.lose('lose-before-apply');
  await approve();
  await reconcileOpenCommands(deps, operatorId);
  const sends = stub.received.filter(({ route }) => route === 'setBetaAccess');
  const ids = sends.map(
    ({ body }) => (body as { commandId: string }).commandId,
  );
  const anchors = sends.map(
    ({ body }) => (body as { adminAuditHead: string }).adminAuditHead,
  );
  assert({
    given: 'a command the participant app never received',
    should:
      'resend it under the same command id and anchor with a fresh nonce, then settle it',
    actual: [
      stub.received.map(({ route }) => route),
      new Set(ids).size,
      new Set(anchors).size,
      new Set(stub.received.map(({ nonce }) => nonce)).size,
      await kinds(),
      await openCount(),
    ],
    expected: [
      ['setBetaAccess', 'readCommand', 'setBetaAccess'],
      1,
      1,
      3,
      [
        'command.intent::approved',
        'command.outcome:unknown:',
        'command.outcome:changed:mail_queued',
      ],
      0,
    ],
  });
});

test('a stale form', async () => {
  const { stub, approve } = await setup();
  const account = stub.accounts.get(userId);
  if (account) account.accessRevision = 2;
  const view = await approve(1);
  assert({
    given: 'an approval carrying a revision the account has moved past',
    should: 'conflict, change nothing and settle the command',
    actual: [
      view,
      stub.accounts.get(userId)?.accessState,
      await kinds(),
      await openCount(),
    ],
    expected: [
      { notice: 'conflict', mail: null },
      'pending',
      ['command.intent::approved', 'command.outcome:rejected:CONFLICT:'],
      0,
    ],
  });
});

test('an operator disabled mid-session', async () => {
  const { stub, operatorId, approve } = await setup();
  await db
    .update(operators)
    .set({ disabledAt: new Date('2026-10-26T11:59:00.000Z') })
    .where(eq(operators.id, operatorId));
  const view = await approve();
  assert({
    given: 'a command from an operator disabled after the page loaded',
    should: 'deny it, audit the denial and send nothing',
    actual: [
      view,
      await kinds(),
      (await db.select().from(pendingCommands)).length,
      stub.received.length,
    ],
    expected: [
      { notice: 'denied' },
      ['access.denied::operator_disabled'],
      0,
      0,
    ],
  });
});
