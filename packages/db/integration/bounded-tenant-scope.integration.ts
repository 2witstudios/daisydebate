import { sql } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { scopeTransaction } from '../src/tenant-scope';
import { withBoundedRound } from './bounded-transaction.test-support';
setupRitewayBun();

test('the bounded adapter owns tenant scoping without lending transaction configuration', async () => {
  await withBoundedRound(async (_fixture, run) => {
    const lobbyId = createId(),
      organizationId = createId(),
      subjectUserId = createId();
    let escaped: (() => Promise<void>) | null = null;
    await run(async (tx) => {
      const before = await tx.execute(
        sql`select current_setting('statement_timeout') as statement,current_setting('lock_timeout') as lock,current_setting('idle_in_transaction_session_timeout') as idle`,
      );
      const request = {
        lobbyId,
        organizationId,
        subjectUserId,
        statement_timeout: '0',
        lock_timeout: '0',
      };
      await scopeTransaction(tx, request);
      const scope = await tx.execute(
        sql`select current_setting('daisy.lobby_scope') as lobby,current_setting('daisy.organization_scope') as organization,current_setting('daisy.subject_scope') as subject`,
      );
      const after = await tx.execute(
        sql`select current_setting('statement_timeout') as statement,current_setting('lock_timeout') as lock,current_setting('idle_in_transaction_session_timeout') as idle`,
      );
      assert({
        given: 'a trusted tenant-scope request inside the bounded owner',
        should: 'set only the three tenant keys and retain every timeout',
        actual: [Array.from(scope), Array.from(after)],
        expected: [
          [
            {
              lobby: lobbyId,
              organization: organizationId,
              subject: subjectUserId,
            },
          ],
          Array.from(before),
        ],
      });
      await scopeTransaction(tx, { lobbyId });
      const cleared = await tx.execute(
        sql`select current_setting('daisy.organization_scope') as organization,current_setting('daisy.subject_scope') as subject`,
      );
      assert({
        given: 'a new scope with absent organization and subject',
        should: 'clear both prior values',
        actual: Array.from(cleared),
        expected: [{ organization: '', subject: '' }],
      });
      escaped = () => scopeTransaction(tx, { lobbyId });
    });
    await assertRejects({
      given: 'a structurally copied DML context',
      should: 'refuse a forged adapter scope owner',
      actual: () =>
        run((tx) => scopeTransaction({ execute: tx.execute }, { lobbyId })),
      code: 'INVARIANT',
    });
    if (!escaped) throw new Error('Bounded scope resource missing');
    await assertRejects({
      given: 'a tenant-scope resource retained beyond commit',
      should: 'respect the closed bounded lifetime',
      actual: escaped,
      code: 'INVARIANT',
    });
  });
});
