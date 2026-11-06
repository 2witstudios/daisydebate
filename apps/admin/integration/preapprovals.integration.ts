import { requireTestServices } from '@daisy/config';
import { eq } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  submitPreapproval,
  reconcileOpenCommands,
} from '../src/features/accounts/commands';
import { pendingCommands, auditEvents, operators } from '../src/db/schema';
import { setupCommands } from './commands.test-support';
import { suiteDatabase } from './admin.test-support';
requireTestServices(process.env);
setupRitewayBun();
const { db } = suiteDatabase();

test('a lost preapproval response reconciles once and removes its personal pending payload', async () => {
  const { deps, operatorId, stub } = await setupCommands(db);
  const command = {
    v: 1,
    commandId: deps.ids.next(),
    adminAuditHead: 'a'.repeat(64),
    operation: 'add',
    email: 'beta+one@example.test',
    invite: true,
  } as const;
  stub.lose('lose-after-apply');
  const submitted = await submitPreapproval(deps, operatorId, command);
  const open = await db.select().from(pendingCommands);
  const reconciled = await reconcileOpenCommands(deps, operatorId);
  const again = await reconcileOpenCommands(deps, operatorId);
  const remaining = await db.select().from(pendingCommands);
  const audit = await db.select().from(auditEvents);
  assert({
    given:
      'an owner invitation command applied but its signed response was lost',
    should:
      'show unknown, durably retain the explicit payload, reconcile once without a second write and then erase the email payload',
    actual: [
      submitted.notice,
      open.length,
      open[0]?.preapproval !== null,
      reconciled,
      again,
      remaining.length,
      stub.received.filter(({ route }) => route === 'updatePreapproval').length,
      JSON.stringify(audit).includes(command.email),
    ],
    expected: [
      'unknown',
      1,
      true,
      { settled: 1, open: 0 },
      { settled: 0, open: 0 },
      0,
      1,
      false,
    ],
  });
});

test('a non-owner cannot sign a preapproval command', async () => {
  const { deps, operatorId, stub } = await setupCommands(db);
  await db
    .update(operators)
    .set({ role: 'operator' })
    .where(eq(operators.id, operatorId));
  const result = await submitPreapproval(deps, operatorId, {
    v: 1,
    commandId: deps.ids.next(),
    adminAuditHead: 'a'.repeat(64),
    operation: 'add',
    email: 'unapproved@example.test',
    invite: false,
  });
  assert({
    given: 'a live operator without the owner role',
    should: 'refuse before signing or storing personal command data',
    actual: [
      result.notice,
      stub.received.length,
      (await db.select().from(pendingCommands)).length,
    ],
    expected: ['denied', 0, 0],
  });
});
