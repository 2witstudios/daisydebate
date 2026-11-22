import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { finishedOrBlockedBehind } from '@daisy/db/testing';
import { runBetaAccessCommand } from '../src/features/operator-api/beta-access-command';
import { api, signed } from '../src/features/operator-api/router.test-support';
import { withBeta } from './preapproval.test-support';

setupRitewayBun();
const command = (state: 'approved' | 'revoked', expectedRevision: number) => ({
  v: 1,
  commandId: createId(),
  state,
  expectedRevision,
  adminAuditHead: 'a'.repeat(64),
});
const put = (userId: string, body: ReturnType<typeof command>) =>
  signed({
    method: 'PUT',
    path: `/operator/v1/accounts/${userId}/beta-access`,
    body: JSON.stringify(body),
  });

test('the real Beta access driver preserves replay before authority and final liveness', async () => {
  await withBeta(async ({ db, account }) => {
    const person = await account();
    const input = {
      commandId: createId(),
      serviceId: 'daisy-admin',
      operatorRef: 'o'.repeat(24),
      targetUserId: person.userId,
      desired: 'approved' as const,
      expectedRevision: 1,
      requestDigest: 'a'.repeat(64),
      adminAuditHead: 'a'.repeat(64),
      nextId: createId,
      live: () => true,
    };
    const saved = await runBetaAccessCommand(db, input, () => true);
    const replay = await runBetaAccessCommand(
      db,
      { ...input, live: () => false },
      () => false,
    );
    assert({
      given:
        'an applied command retried with now-refused fresh authority and liveness',
      should: 'replay its exact result without a new decision',
      actual: [saved.kind, replay.kind, replay.result],
      expected: ['applied', 'replayed', saved.result],
    });
  });
});

test('signed Beta access applies, no-ops, replays and revokes through the actual driver', async () => {
  await withBeta(async ({ db, sql, account }) => {
    const person = await account();
    const logs: string[] = [];
    const { handle } = api({
      store: db,
      nextId: createId,
      logger: {
        log: (event) => {
          logs.push(event);
        },
      },
    });
    const approve = command('approved', 1);
    const first = await handle(put(person.userId, approve));
    const result = await first.json();
    const replay = await handle(put(person.userId, approve));
    const noOpCommand = command('approved', 2);
    const noOp = await handle(put(person.userId, noOpCommand));
    const unchanged = await noOp.json();
    const revoked = await handle(put(person.userId, command('revoked', 2)));
    const read = await handle(
      signed({
        method: 'GET',
        path: `/operator/v1/commands/${approve.commandId}`,
      }),
    );
    const readback = await read.json();
    const [effects] =
      await sql`select (select state from account_beta_access where user_id=${person.userId}) as state, (select revision from account_beta_access where user_id=${person.userId}) as revision, (select count(*)::int from account_access_events where user_id=${person.userId}) as events, (select count(*)::int from account_entitlement_grants where user_id=${person.userId}) as grants, (select result->>'outcome' from operator_command_receipts where command_id=${noOpCommand.commandId}) as unchanged_receipt`;
    assert({
      given:
        'real signed approval, replay, unchanged approval, revocation and issuer readback',
      should:
        'preserve typed outcomes, one log per fresh apply, revision and entitlement effects',
      actual: [
        first.status,
        replay.status,
        await replay.json(),
        noOp.status,
        unchanged.outcome,
        revoked.status,
        read.status,
        readback.result,
        readback.mailState,
        logs.filter((e) => e === 'operator.command.applied').length,
        effects,
      ],
      expected: [
        200,
        200,
        result,
        200,
        'unchanged',
        200,
        200,
        result,
        'queued',
        3,
        {
          state: 'revoked',
          revision: 3,
          events: 2,
          grants: 0,
          unchanged_receipt: 'unchanged',
        },
      ],
    });
  });
});

test('the signed Beta access decision reads the account after its exclusive fence', async () => {
  await withBeta(async ({ db, sql, account }) => {
    const person = await account();
    const { handle } = api({ store: db, nextId: createId });
    let response: Promise<Response> | undefined;
    let waited = '';
    try {
      await sql.begin(async (tx) => {
        await tx`select * from public.daisy_authorization_accounts_v2(array[${person.actorId}]::text[],null::text,true)`;
        const [holder] = await tx`select pg_backend_pid() as pid`;
        response = handle(put(person.userId, command('approved', 1)));
        waited = await finishedOrBlockedBehind(response, sql, holder!.pid, {
          now: Date.now,
          deadlineMs: 1500,
        });
        await tx`update account_beta_access set revision=2 where user_id=${person.userId}`;
      });
      const answer = await response!;
      const [effects] =
        await sql`select state, revision from account_beta_access where user_id=${person.userId}`;
      assert({
        given:
          'a signed approval waiting while the account revision changes behind the canonical exclusive fence',
        should: 'decide from the newly committed facts and refuse stale input',
        actual: [waited, answer.status, effects],
        expected: ['blocked', 409, { state: 'pending', revision: 2 }],
      });
    } finally {
      await response?.catch(() => undefined);
    }
  });
});
