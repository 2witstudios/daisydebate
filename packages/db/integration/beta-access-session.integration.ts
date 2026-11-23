import { hostWaits } from '@daisy/worker/host';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from '../src';
import { withFixture } from './constraint-helpers';
import { command, pendingAccount } from './operator-accounts.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('Beta access sessions require settlement and bound writers, while replay needs no writer or live check', async () => {
  await withFixture(url, async (f) => {
    const account = await pendingAccount(f);
    const db = createDatabase({ waits: hostWaits, url, nextActorId: createId });
    const input = command(account.userId, 'approved', 1);
    const decision = {
      kind: 'changed',
      from: 'pending',
      to: 'approved',
      revision: 2,
    } as const;
    const rejected: string[] = [];
    const escaped: { apply?: () => Promise<unknown> } = {};
    try {
      for (const mode of ['missing', 'exception', 'late'] as const) {
        await db
          .betaAccessCommand(
            { ...input, live: () => mode !== 'late' },
            async (session) => {
              const loaded = await session.load();
              if (loaded.kind !== 'fresh') throw createAppError('INVARIANT');
              if (mode === 'exception') throw createAppError('CONFLICT');
              if (mode === 'late') await loaded.apply(decision);
            },
          )
          .catch((error: { code: string }) => {
            rejected.push(error.code);
          });
      }
      const [before] =
        await f.sql`select (select state from account_beta_access where user_id=${account.userId}) as state, (select count(*)::int from operator_command_receipts where command_id=${input.commandId}) as receipts, (select count(*)::int from mail_intents where dedupe_key=${`beta-approved:${input.commandId}`}) as mail`;
      const saved = await db.betaAccessCommand(input, async (session) => {
        const loaded = await session.load();
        if (loaded.kind !== 'fresh') throw createAppError('INVARIANT');
        escaped.apply = () => loaded.apply(decision);
        await loaded.apply(decision);
        for (const repeat of [
          () => session.load(),
          () => loaded.apply(decision),
        ])
          await repeat().catch((error: { code: string }) => {
            rejected.push(error.code);
          });
      });
      await escaped.apply?.().catch((error: { code: string }) => {
        rejected.push(error.code);
      });
      let shape: unknown;
      const replay = await db.betaAccessCommand(
        { ...input, live: () => false },
        async (session) => {
          const loaded = await session.load();
          shape = [loaded.kind, 'apply' in loaded];
        },
      );
      assert({
        given:
          'missing settlement, callback failure, expired apply, repeated and escaped writers and a settled replay',
        should:
          'roll back refused effects and allow exactly one applied receipt without a replay writer',
        actual: [before, saved.kind, replay.result, shape, rejected],
        expected: [
          { state: 'pending', receipts: 0, mail: 0 },
          'applied',
          saved.result,
          ['replayed', false],
          [
            'INVARIANT',
            'CONFLICT',
            'CONFLICT',
            'INVARIANT',
            'INVARIANT',
            'INVARIANT',
          ],
        ],
      });
    } finally {
      await f.sql`delete from mail_intents where dedupe_key=${`beta-approved:${input.commandId}`}`;
      await f.sql`delete from operator_command_receipts where command_id=${input.commandId}`;
      await f.sql`delete from account_entitlement_grants where user_id=${account.userId}`;
      await db.close();
    }
  });
});
