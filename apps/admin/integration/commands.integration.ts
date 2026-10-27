import { requireTestServices } from '@daisy/config';
import { eq } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { acknowledgedAnchors } from '../src/audit/store';
import { reconcileOpenCommands } from '../src/features/accounts/commands';
import { auditEvents, operators, pendingCommands } from '../src/db/schema';
import { suiteDatabase } from './admin.test-support';
import {
  kinds,
  openCount,
  setupCommands,
  userId,
} from './commands.test-support';

requireTestServices(process.env);
setupRitewayBun();
const { db } = suiteDatabase();

test('the intent is durable before the command is sent', async () => {
  const seen: unknown[] = [];
  const { approve } = await setupCommands(db, {
    observe: async (body) => {
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
    },
  });
  const view = await approve();
  assert({
    given: 'an approval',
    should:
      'send only after the pending command and its intent exist, anchored to the head after the intent',
    actual: [
      seen,
      view,
      await kinds(db),
      await openCount(db),
      await acknowledgedAnchors(db),
    ],
    expected: [
      [{ anchored: true, sameId: true, open: true }],
      { notice: 'changed', mail: 'queued' },
      ['command.intent::approved', 'command.outcome:changed:mail_queued'],
      0,
      1,
    ],
  });
});

test('a response lost after the change applied', async () => {
  const { deps, stub, operatorId, approve } = await setupCommands(db);
  stub.lose('lose-after-apply');
  const view = await approve();
  const afterLoss = [
    await kinds(db),
    await openCount(db),
    await acknowledgedAnchors(db),
  ];
  const reconciled = await reconcileOpenCommands(deps, operatorId);
  assert({
    given: 'an approval whose response never arrived, then a reconciliation',
    should:
      'record unknown and keep it open, then read the stored result back by the same command id',
    actual: [
      view,
      afterLoss,
      reconciled,
      await kinds(db),
      await openCount(db),
      stub.received.map(({ route }) => route),
      stub.accounts.get(userId)?.accessState,
      await acknowledgedAnchors(db),
    ],
    expected: [
      { notice: 'unknown', mail: null },
      [['command.intent::approved', 'command.outcome:unknown:'], 1, 0],
      { settled: 1, open: 0 },
      [
        'command.intent::approved',
        'command.outcome:unknown:',
        'command.reconciled:changed:mail_queued',
      ],
      0,
      ['setBetaAccess', 'readCommand'],
      'approved',
      1,
    ],
  });
});

test('a command lost before it arrived', async () => {
  const { deps, stub, operatorId, approve } = await setupCommands(db);
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
      await kinds(db),
      await openCount(db),
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
  const { stub, approve } = await setupCommands(db);
  const account = stub.accounts.get(userId);
  if (account) account.accessRevision = 2;
  const view = await approve(1);
  assert({
    given: 'an approval carrying a revision the account has moved past',
    should: 'conflict, change nothing and settle the command',
    actual: [
      view,
      stub.accounts.get(userId)?.accessState,
      await kinds(db),
      await openCount(db),
      await acknowledgedAnchors(db),
    ],
    expected: [
      { notice: 'conflict', mail: null },
      'pending',
      ['command.intent::approved', 'command.outcome:rejected:CONFLICT:'],
      0,
      0,
    ],
  });
});

test('an operator disabled mid-session', async () => {
  const { stub, operatorId, approve } = await setupCommands(db);
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
      await kinds(db),
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
