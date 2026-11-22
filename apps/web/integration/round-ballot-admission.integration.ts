import { randomBytes } from 'node:crypto';
import { canUseAiAllowance } from '@daisy/auth/authorization';
import { atFinalJudgingStage } from '@daisy/db/testing';
import { judgingJobRules } from '@daisy/debate-engine';
import { createRoundJudgingOperations } from '../src/features/round-judging/operations';
import { botAdmissionForTests } from './bot-admission.test-support';
import { seedSettledAttendanceLedger } from './round-attendance-fixture.test-support';
import { freezeBotJudge } from './round-judging.test-support';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { finishedOrBlockedBehind } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoundBallotOperations } from '../src/features/round-ballots/operations';
import { finalizeAsWeb } from './round-maintenance.test-support';
import {
  fixtureBallot,
  readyTwoHumanJudgeRoom,
} from './round-judging.test-support';
import {
  launchRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';

setupRitewayBun();

test('shared ballot preparation admits fresh locked facts, rolls back refusal and preserves replay precedence', async () => {
  await withRoomRuntime(async (f) => {
    const { room, judges } = await readyTwoHumanJudgeRoom(f);
    const { roundId } = await launchRuntimeRound(f, room);
    const initial = (await f.store.getRound(roundId))!;
    const elapsed = initial.rules.segments.reduce(
      (sum, s) => sum + s.durationMs + initial.rules.countdownMs,
      125_000,
    );
    await f.sql`update rounds set started_at=clock_timestamp()-${elapsed}*interval '1 millisecond' where id=${roundId}`;
    const frozen = await finalizeAsWeb(f, roundId);
    if (frozen.status !== 'frozen') throw Error('Expected actual freeze');
    const fresh = (await f.store.getRound(roundId))!;
    const judge = judges[0]!;
    const principal = { kind: 'human' as const, actorId: judge.actorId };
    const envelope = {
      version: 1 as const,
      commandId: createId(),
      expectedVersion: fresh.version,
      judgeParticipantId: fresh.participants.find(
        (p) => p.actorId === judge.actorId,
      )!.id,
      freezeRevision: frozen.freeze.revision,
      ballot: fixtureBallot('The decisive clash was answered.', 'affirmative'),
    };
    let refuse: 'capture' | 'ballot' | null = null;
    let captureDecisions = 0,
      ballotDecisions = 0;
    const operation = createRoundBallotOperations({
      nextBallotId: createId,
      nextSegmentId: createId,
      store: {
        executeRoundBallot: (input) =>
          f.store.executeRoundBallot({
            ...input,
            admitCapture: (facts) => {
              captureDecisions++;
              input.admitCapture(facts);
              if (refuse === 'capture') throw createAppError('CONFLICT');
            },
            admitBallot: (facts) => {
              ballotDecisions++;
              input.admitBallot(facts);
              if (refuse === 'ballot') throw createAppError('CONFLICT');
            },
          }),
      },
    });
    const state = async () => {
      const [row] = await f.sql`select jsonb_build_object(
        'round', (select to_jsonb(r) from rounds r where id=${roundId}),
        'ballots', (select jsonb_agg(to_jsonb(b) order by b.id) from ballots b where round_id=${roundId}),
        'receipts', (select jsonb_agg(to_jsonb(c) order by c.command_id) from round_commands c where round_id=${roundId}),
        'screening', (select jsonb_agg(to_jsonb(s) order by s.ballot_id) from ballot_screenings s join ballots b on b.id=s.ballot_id where b.round_id=${roundId})
      ) as state`;
      return row.state;
    };
    const before = await state();
    for (const stage of ['capture', 'ballot'] as const) {
      refuse = stage;
      await assertRejects({
        given: `application ${stage} refusal on a real frozen Round`,
        should: 'refuse the actual submission without atomic writes',
        actual: () => operation.submit(principal, roundId, envelope),
        code: 'CONFLICT',
      });
      assert({
        given: `the ${stage} refusal`,
        should: 'preserve Round, ballot, screening and receipt state',
        actual: await state(),
        expected: before,
      });
    }
    refuse = null;
    ballotDecisions = 0;
    await assertRejects({
      given: 'a stale version and an otherwise admissible ballot',
      should: 'refuse binding before consulting new-ballot policy',
      actual: () =>
        operation.submit(principal, roundId, {
          ...envelope,
          expectedVersion: fresh.version - 1,
        }),
      code: 'CONFLICT',
    });
    assert({
      given: 'the stale binding',
      should: 'skip the application new-ballot decision',
      actual: ballotDecisions,
      expected: 0,
    });
    const receipt = await operation.submit(principal, roundId, envelope);
    refuse = 'ballot';
    const captureBefore = captureDecisions,
      ballotBefore = ballotDecisions;
    assert({
      given: 'an exact accepted replay with a now-refusing new-ballot decision',
      should:
        'recheck capture but recover the receipt before new-ballot policy',
      actual: [
        await operation.submit(principal, roundId, envelope),
        captureDecisions - captureBefore,
        ballotDecisions - ballotBefore,
      ],
      expected: [receipt, 1, 0],
    });
    refuse = 'capture';
    await assertRejects({
      given: 'an exact replay with refused capture',
      should: 'refuse before receipt recovery',
      actual: () => operation.submit(principal, roundId, envelope),
      code: 'CONFLICT',
    });
    refuse = null;
    const acceptedState = await state();
    const holder = await f.sql.reserve();
    let pending: Promise<{ code: string | undefined }> | undefined;
    try {
      await holder`begin`;
      await holder`select * from public.daisy_authorization_accounts_v2(array[${judge.actorId}]::text[],null::text,true)`;
      const [owner] = await holder`select pg_backend_pid() as pid`;
      const capturesBeforeWait = captureDecisions;
      pending = operation.submit(principal, roundId, envelope).then(
        () => ({ code: 'ACCEPTED' }),
        (error: { code?: string }) => ({ code: error.code }),
      );
      assert({
        given: 'canonical account mutation holding the fence',
        should: 'block the actual replay at the account fence',
        actual: await finishedOrBlockedBehind(
          pending,
          f.sql,
          Number(owner!.pid),
          { now: performance.now },
        ),
        expected: 'blocked',
      });
      await holder`update users set username='' where id=${judge.userId}`;
      await holder`commit`;
      assert({
        given: 'membership revoked during the actual account wait',
        should:
          'refuse before capture or replay with the stored receipt untouched',
        actual: [
          await pending,
          captureDecisions - capturesBeforeWait,
          await state(),
        ],
        expected: [{ code: 'AUTHORIZATION' }, 0, acceptedState],
      });
    } finally {
      await holder`rollback`;
      holder.release();
      await pending;
    }
    assert({
      given: 'all refusals and exact replays',
      should: 'leave just one frozen ballot and its atomic receipt',
      actual: [
        (await f.sql`select id from ballots where round_id=${roundId}`).length,
        (
          await f.sql`select command_id from round_commands where round_id=${roundId} and type='submit_ballot'`
        ).length,
      ],
      expected: [1, 1],
    });
  });
});

test('the actual cached AI result uses shared admission and rolls back refusal without spending its response', async () => {
  await withRoomRuntime(
    async (f) => {
      const { roundId, target } = await freezeBotJudge(f);
      await atFinalJudgingStage(f.sql, target);
      const claim = await f.store.claimRoundJudgingJob(target);
      await f.store.beginRoundJudgingModelCall(
        claim.scope,
        claim.token,
        'final',
      );
      await f.store.saveRoundJudgingResult(
        claim.scope,
        claim.token,
        fixtureBallot('A validated cached answer.', 'negative'),
        { inputTokens: 1, outputTokens: 1 },
      );
      await seedSettledAttendanceLedger(f, roundId);
      let refuse = true;
      let admitted = 0;
      const operations = createRoundJudgingOperations({
        store: {
          ...f.store,
          submitRoundJudgingResult: (scope, token, prepared) =>
            f.store.submitRoundJudgingResult(scope, token, {
              ...prepared,
              admitBallot: (facts) => {
                prepared.admitBallot(facts);
                admitted++;
                if (refuse) throw createAppError('CONFLICT');
              },
            }),
        },
        nextId: createId,
        voice: () => {
          throw Error('A cached answer never calls the provider');
        },
        withProvider: async () => {
          throw Error('A cached answer takes no provider slot');
        },
      });
      const state = async () => {
        const [row] = await f.sql`select jsonb_build_object(
        'round', (select to_jsonb(r) from rounds r where id=${roundId}),
        'job', (select to_jsonb(j) from round_judging_jobs j where round_id=${roundId}),
        'ballots', (select jsonb_agg(to_jsonb(b) order by b.id) from ballots b where round_id=${roundId}),
        'receipts', (select jsonb_agg(to_jsonb(c) order by c.command_id) from round_commands c where round_id=${roundId})
      ) as state`;
        return row.state;
      };
      const before = await state();
      await assertRejects({
        given:
          'a real leased AI job holding a validated response, refused by application admission',
        should: 'roll back shared ballot completion',
        actual: () =>
          operations.executeClaim(claim, new AbortController().signal),
        code: 'CONFLICT',
      });
      assert({
        given: 'application refusal in the result transaction',
        should:
          'preserve the held response, lease, Round, ballots and receipts',
        actual: [admitted, await state()],
        expected: [1, before],
      });
      refuse = false;
      await operations.executeClaim(claim, new AbortController().signal);
      const [counts] = await f.sql`select status,
      (select count(*)::int from ballots where round_id=${roundId}) ballots,
      (select count(*)::int from round_commands where round_id=${roundId} and type='submit_ballot') receipts
      from round_judging_jobs where round_id=${roundId}`;
      assert({
        given: 'retry of the same held response after admission',
        should:
          'complete one immutable ballot and one atomic receipt without another provider call',
        actual: counts,
        expected: { status: 'succeeded', ballots: 1, receipts: 1 },
      });
    },
    {
      ...botAdmissionForTests,
      judging: {
        leaseMs: 60000,
        model: 'fixture-model',
        nextToken: () => randomBytes(32).toString('base64url'),
        contractVersion: 'fixture-contract',
        rules: judgingJobRules,
        accountEligible: canUseAiAllowance,
      },
    },
  );
});
