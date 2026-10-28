import { setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { operatorAccountOperations } from './operator-accounts';
setupRitewayBun();

/** A receipt row read back for the command, with this stored action. */
const withAction = (action: string) =>
  operatorAccountOperations({
    database: {
      execute: async () => [{ action, result: {} }],
      transaction: async () => {
        throw new Error('unused');
      },
    } as never,
  });

test('a receipt whose action no owner registered refuses as a typed error, prototype names included (ISSUE-781)', async () => {
  for (const action of ['account.erase', 'toString', 'constructor'])
    await assertRejects({
      given: `a stored receipt with action ${action}`,
      should: 'refuse as INFRASTRUCTURE, never call a prototype member',
      code: 'INFRASTRUCTURE',
      actual: () =>
        withAction(action).readOperatorCommand({
          commandId: 'c'.repeat(24),
          serviceId: 'daisy-admin',
        }),
    });
});
