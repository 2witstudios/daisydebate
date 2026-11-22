import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import { createId } from '@paralleldrive/cuid2';
import { sha3Hex } from '@daisy/digest';
import { decidePreapprovalChange } from '@daisy/protocol/beta-preapproval';
import { createDatabase } from '../src';
import { withFixture } from './constraint-helpers';
import { pendingAccount } from './operator-accounts.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
const inputFor = (email: string, live = () => true) => {
  const command = {
    v: 1 as const,
    commandId: createId(),
    adminAuditHead: 'a'.repeat(64),
    operation: 'add' as const,
    email,
    invite: true,
  };
  return {
    command,
    serviceId: 'daisy-admin',
    operatorRef: 'o'.repeat(24),
    requestDigest: sha3Hex(JSON.stringify(command)),
    nextId: createId,
    live,
  };
};

test('preparing preapproval effects roll back on refusal, exception, missing apply, receipt failure or late deadline', async () => {
  for (const mode of [
    'refusal',
    'exception',
    'missing-apply',
    'receipt-failure',
    'late-deadline',
  ] as const) {
    await withFixture(url, async (f) => {
      const account = await pendingAccount(f);
      const db = createDatabase({ url, nextActorId: createId });
      let live = true;
      const input = inputFor(`${account.userId}@operator.invalid`, () => live);
      const id = input.command.commandId;
      const trigger = `preapproval_receipt_${id}`;
      const [before] =
        await f.sql`select version from users where id=${account.userId}`;
      try {
        if (mode === 'receipt-failure') {
          await f.sql.unsafe(
            `create function ${trigger}() returns trigger language plpgsql as $$ begin if new.command_id = '${id}' then raise exception 'controlled receipt rejection'; end if; return new; end $$`,
          );
          await f.sql.unsafe(
            `create trigger ${trigger} before insert on operator_command_receipts for each row execute function ${trigger}()`,
          );
        }
        const result = await db
          .preapprovalCommand(input, async (session) => {
            const loaded = await session.load();
            if (loaded.kind !== 'fresh') throw createAppError('INVARIANT');
            if (mode === 'refusal') throw createAppError('CONFLICT');
            if (mode === 'exception') throw createAppError('INTERNAL');
            if (mode === 'missing-apply') return;
            if (mode === 'late-deadline') live = false;
            const decision = decidePreapprovalChange(loaded.facts);
            if (decision.kind === 'refused')
              throw createAppError(decision.code);
            await loaded.apply(decision);
          })
          .then(
            () => 'committed',
            () => 'rejected',
          );
        const [effects] = await f.sql`select
          (select count(*)::int from beta_preapprovals where email=${input.command.email}) as grants,
          (select state from account_beta_access where user_id=${account.userId}) as access,
          (select count(*)::int from account_access_events where command_id=${id}) as audit,
          (select count(*)::int from account_entitlement_grants where user_id=${account.userId}) as entitlements,
          (select version from users where id=${account.userId})=${before!.version} as revision_unchanged,
          (select count(*)::int from operator_command_receipts where command_id=${id}) as receipts,
          (select count(*)::int from mail_intents where dedupe_key=${`beta-invitation:${id}`}) as mail`;
        assert({
          given: `a preparing load followed by ${mode}`,
          should:
            'reject and roll back the grant, account approval, entitlements, revision, audit, receipt and mail',
          actual: [result, effects],
          expected: [
            'rejected',
            {
              grants: 0,
              access: 'pending',
              audit: 0,
              entitlements: 0,
              revision_unchanged: true,
              receipts: 0,
              mail: 0,
            },
          ],
        });
      } finally {
        if (mode === 'receipt-failure') {
          await f.sql.unsafe(
            `drop trigger if exists ${trigger} on operator_command_receipts`,
          );
          await f.sql.unsafe(`drop function if exists ${trigger}()`);
        }
        await f.sql`delete from mail_intents where dedupe_key=${`beta-invitation:${id}`}`;
        await f.sql`delete from operator_command_receipts where command_id=${id}`;
        await f.sql`delete from beta_preapprovals where email=${input.command.email}`;
        await f.sql`delete from account_entitlement_grants where user_id=${account.userId}`;
        await db.close();
      }
    });
  }
});

test('a preapproval session replays without a writer and rejects repeated or escaped load and apply', async () => {
  await withFixture(url, async (f) => {
    const db = createDatabase({ url, nextActorId: createId });
    const input = inputFor(`${createId()}@example.test`);
    let escaped: (() => Promise<unknown>) | null = null;
    const rejected: string[] = [];
    try {
      const saved = await db.preapprovalCommand(input, async (session) => {
        const loaded = await session.load();
        if (loaded.kind !== 'fresh') throw createAppError('INVARIANT');
        const decision = decidePreapprovalChange(loaded.facts);
        if (decision.kind === 'refused') throw createAppError(decision.code);
        escaped = () => loaded.apply(decision);
        await loaded.apply(decision);
        for (const repeat of [
          () => session.load(),
          () => loaded.apply(decision),
        ])
          await repeat().catch((error: { code?: string }) => {
            rejected.push(error.code ?? 'error');
          });
      });
      if (escaped)
        await (escaped as () => Promise<unknown>)().catch(
          (error: { code?: string }) => {
            rejected.push(error.code ?? 'error');
          },
        );
      let replayShape: unknown;
      const replay = await db.preapprovalCommand(input, async (session) => {
        const loaded = await session.load();
        replayShape = [loaded.kind, 'apply' in loaded];
      });
      const [effects] =
        await f.sql`select (select count(*)::int from operator_command_receipts where command_id=${input.command.commandId}) as receipts,(select count(*)::int from mail_intents where dedupe_key=${`beta-invitation:${input.command.commandId}`}) as mail`;
      assert({
        given:
          'one applied command, repeated capabilities, an escaped writer and the same receipt replay',
        should:
          'retain exactly one result and mail while exposing no replay writer',
        actual: [
          saved.kind === 'settled',
          replay,
          replayShape,
          rejected,
          effects,
        ],
        expected: [
          true,
          saved,
          ['replayed', false],
          ['INVARIANT', 'INVARIANT', 'INVARIANT'],
          { receipts: 1, mail: 1 },
        ],
      });
    } finally {
      await f.sql`delete from mail_intents where dedupe_key=${`beta-invitation:${input.command.commandId}`}`;
      await f.sql`delete from operator_command_receipts where command_id=${input.command.commandId}`;
      await f.sql`delete from beta_preapprovals where email=${input.command.email}`;
      await db.close();
    }
  });
});
