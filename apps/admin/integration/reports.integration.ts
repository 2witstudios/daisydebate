import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { resolveReport } from '../src/features/reports/commands';
import { operators } from '../src/db/schema';
import { suiteDatabase } from './admin.test-support';
import { kinds, setupCommands, userId } from './commands.test-support';

requireTestServices(process.env);
setupRitewayBun();
const { db } = suiteDatabase();

const decision = {
  reportId: 'r'.repeat(24),
  subjectUserId: userId,
  outcome: 'warned',
  suspendDays: null,
} as const;

test('a report decision is audited before and after it is sent', async () => {
  const { deps, operatorId } = await setupCommands(db);
  const anchors: string[] = [];
  const notice = await resolveReport(
    {
      ...deps,
      client: {
        ...deps.client,
        resolveReport: async (_ref, reportId, command) => {
          anchors.push(command.adminAuditHead);
          return {
            kind: 'ok',
            value: {
              commandId: command.commandId,
              reportId,
              outcome: command.outcome,
            },
          };
        },
      },
    },
    { operatorId, ...decision },
  );
  assert({
    given: 'an operator warning a member',
    should: 'write the intent, send its anchor, then record the outcome',
    actual: [
      notice,
      anchors.length,
      (anchors[0] ?? '').length,
      await kinds(db),
    ],
    expected: [
      'resolved',
      1,
      64,
      [
        'command.intent:report.resolve:warned:',
        'command.outcome:report.resolve:warned:ok:',
      ],
    ],
  });
});

test('a disabled operator is refused, audited, and nothing is sent', async () => {
  const { deps, operatorId } = await setupCommands(db);
  await db.update(operators).set({ disabledAt: new Date() });
  let sent = 0;
  const notice = await resolveReport(
    {
      ...deps,
      client: {
        ...deps.client,
        resolveReport: async () => {
          sent += 1;
          return { kind: 'unknown' };
        },
      },
    },
    { operatorId, ...decision },
  );
  assert({
    given: 'an operator disabled since the page rendered',
    should: 'deny, send nothing and audit the denial',
    actual: [notice, sent, await kinds(db)],
    expected: ['denied', 0, ['access.denied::operator_disabled']],
  });
});
