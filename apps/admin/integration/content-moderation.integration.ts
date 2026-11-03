import { requireTestServices } from '@daisy/config';
import { eq } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { auditEvents, operators } from '../src/db/schema';
import { submitModeration } from '../src/features/content-moderation/commands';
import type { OperatorFetch } from '../src/features/operator-client/client';
import { suiteDatabase } from './admin.test-support';
import { setupCommands } from './commands.test-support';

requireTestServices(process.env);
setupRitewayBun();
const { db } = suiteDatabase();

const targetId = 't'.repeat(24);
const answering =
  (answer: () => Promise<Response>, seen: unknown[] = []) =>
  (): OperatorFetch =>
  async (url, init) => {
    seen.push({ url, body: JSON.parse(String(init.body)) });
    return answer();
  };
const applied = async () =>
  Response.json({ v: 1, outcome: 'applied' }, { status: 200 });

const stop = (commandId: string, operatorId: string) => ({
  operatorId,
  commandId,
  request: {
    action: 'broadcast.stop' as const,
    targetId,
    reason: 'technical',
  },
});

test('a moderation command is audited before it is signed and after', async () => {
  const seen: { url: string; body: { adminAuditHead: string } }[] = [];
  const { deps, operatorId } = await setupCommands(db, {
    wrapFetch: answering(applied, seen),
  });
  const commandId = deps.ids.next();
  const notice = await submitModeration(deps, stop(commandId, operatorId));
  const rows = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.commandId, commandId));
  const intent = rows.find((row) => row.kind === 'command.intent');
  const outcome = rows.find((row) => row.kind === 'command.outcome');
  assert({
    given: 'a stop the participant applied',
    should: 'anchor the send on the intent and record the closed outcome',
    actual: [
      notice,
      seen[0]?.url,
      seen[0]?.body.adminAuditHead === intent?.hash,
      intent?.outcome,
      outcome?.outcome,
    ],
    expected: [
      'applied',
      `http://operator.test/operator/v1/broadcasts/${targetId}/stop`,
      true,
      `broadcast.stop:${targetId}`,
      'applied',
    ],
  });
});

test('silence is unknown, and the same form replays the same command', async () => {
  const seen: { body: { commandId: string } }[] = [];
  const { deps, operatorId } = await setupCommands(db, {
    wrapFetch: answering(async () => {
      throw new TypeError('network');
    }, seen),
  });
  const commandId = deps.ids.next();
  const first = await submitModeration(deps, stop(commandId, operatorId));
  const second = await submitModeration(deps, stop(commandId, operatorId));
  assert({
    given: 'two sends of one form with no answer',
    should: 'report unknown twice under one command id',
    actual: [first, second, seen.map((sent) => sent.body.commandId)],
    expected: ['unknown', 'unknown', [commandId, commandId]],
  });
});

test('a disabled operator signs nothing', async () => {
  const seen: unknown[] = [];
  const { deps, operatorId } = await setupCommands(db, {
    wrapFetch: answering(applied, seen),
  });
  await db
    .update(operators)
    .set({ disabledAt: new Date(deps.clock.now()) })
    .where(eq(operators.id, operatorId));
  const notice = await submitModeration(
    deps,
    stop(deps.ids.next(), operatorId),
  );
  assert({
    given: 'an operator disabled since the page loaded',
    should: 'deny and send nothing',
    actual: [notice, seen],
    expected: ['denied', []],
  });
});
