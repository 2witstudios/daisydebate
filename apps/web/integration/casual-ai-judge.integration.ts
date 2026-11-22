import {
  isJudgeSeat,
  judgeSeat,
  negativeSide,
  sideSeat,
} from '@daisy/protocol/seats';
import { canUseAiAllowance } from '@daisy/auth/authorization';
import { atFinalJudgingStage } from '@daisy/db/testing';
import { randomBytes } from 'node:crypto';
import { judgingJobRules } from '@daisy/debate-engine';
import { seedRatingSeason } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';

import { botAdmissionForTests } from './bot-admission.test-support';
import { readyRankedRoom } from './ranked-room.test-support';
import { withRoomRuntime } from './room-runtime.test-support';
import { createRoundJudgingOperations } from '../src/features/round-judging/operations';
import {
  assembleJudgedRoom,
  fixtureBallot,
  freezeBotJudge,
  readBallotAs,
} from './round-judging.test-support';
import { finalizeByMaintenance } from './round-maintenance.test-support';
import { seedSettledAttendanceLedger } from './round-attendance-fixture.test-support';
setupRitewayBun();

const casualTemplate = {
  kind: 'catalog' as const,
  formatId: 'nsda-ld',
  formatVersion: 1,
  presetVersion: 1,
  competitionType: 'casual' as const,
};

test('a casual AI judge seat needs the host’s own grant, refused on the server and unchanged in the Room', async () => {
  await withRoomRuntime(async (f) => {
    const { actorId: judgeId } = await f.aiJudge();
    const withdraw = (userId: string) =>
      f.sql`delete from account_entitlement_grants where user_id=${userId} and entitlement='casual_ai_judge'`;

    const entitled = await f.create({ selection: casualTemplate });
    const seated = await f.command(f.host, entitled.view, {
      type: 'assign-seat',
      actorId: judgeId,
      seat: judgeSeat(),
    });
    assert({
      given: 'a casual host holding the grant beta approval wrote',
      should: 'seat the AI judge and say seating is included',
      actual: [
        seated.view.participants.some((p) => p.kind === 'bot'),
        seated.view.aiJudgeSeating,
      ],
      expected: [true, 'included'],
    });

    const other = await f.member();
    await withdraw(other.userId);
    const open = await f.create({ selection: casualTemplate }, other);
    const before = await f.snapshot(open.view.id);
    await assertRejects({
      given: 'a casual host without the grant posting the AI judge seat',
      should: 'refuse the command',
      actual: () =>
        f.command(other, open.view, {
          type: 'assign-seat',
          actorId: judgeId,
          seat: judgeSeat(),
        }),
      code: 'CONFLICT',
    });
    const refusal = await f.operations
      .command(other, open.view.id, {
        type: 'assign-seat',
        commandId: createId(),
        expectedVersion: open.view.version,
        actorId: judgeId,
        seat: judgeSeat(),
      })
      .catch((error: { message?: string }) => error.message);
    assert({
      given: 'that refused seat',
      should:
        'name the premium refusal, leave the Room exactly unchanged, and tell the host the free AI judge comes with the free bot Round',
      actual: [
        refusal,
        await f.snapshot(open.view.id),
        (await f.operations.view(other, open.view.id)).aiJudgeSeating,
      ],
      expected: ['ai-judge-premium', before, 'with-bot'],
    });
  });
});

test('a casual create casting the AI judge refuses whole without the grant, and the same host can cast a person', async () => {
  await withRoomRuntime(async (f) => {
    const { actorId: botId } = await f.bot();
    const { actorId: judgeId } = await f.aiJudge();
    const host = await f.member();
    await f.sql`delete from account_entitlement_grants where user_id=${host.userId} and entitlement='casual_ai_judge'`;
    const title = `Practice ${createId()}`;
    await assertRejects({
      given: 'Train’s practice create, or a forged one, seating the AI judge',
      should: 'refuse the whole create',
      actual: () =>
        f.create(
          {
            title,
            selection: casualTemplate,
            cast: [
              { actorId: botId, seat: sideSeat(negativeSide) },
              { actorId: judgeId, seat: judgeSeat() },
            ],
          },
          host,
        ),
      code: 'CONFLICT',
    });
    const rows = await f.sql`select id from rooms where title=${title}`;
    const practice = await f.create(
      {
        title,
        selection: casualTemplate,
        cast: [{ actorId: botId, seat: sideSeat(negativeSide) }],
      },
      host,
    );
    assert({
      given: 'the refused create, then the practice with the judge seat open',
      should:
        'leave no Room behind, then open one with only the bot seated for a person to judge',
      actual: [
        rows.length,
        practice.view.participants.map((p) => [p.seat, p.kind]),
        practice.view.aiJudgeSeating,
      ],
      expected: [0, [[sideSeat(negativeSide), 'bot']], 'not-included'],
    });
  });
});

test('the catalog tells a member whether they hold the casual AI judge', async () => {
  await withRoomRuntime(async (f) => {
    const member = await f.member();
    const held = (await f.operations.catalog(member)).botDebateAiJudge;
    await f.sql`delete from account_entitlement_grants where user_id=${member.userId} and entitlement='casual_ai_judge'`;
    assert({
      given: 'an approved member, then the same member without the grant',
      should: 'say held, then not held',
      actual: [held, (await f.operations.catalog(member)).botDebateAiJudge],
      expected: [true, false],
    });
  });
});

test('a ranked AI judge seat is free: a host holding no grant at all seats it', async () => {
  await withRoomRuntime(async (f) => {
    const seasonId = createId();
    await seedRatingSeason(f.sql, seasonId);
    try {
      await f.sql`delete from account_entitlement_grants where user_id=${f.host.userId}`;
      const room = await readyRankedRoom(f, 'freestyle', 'ai');
      assert({
        given: 'a ranked Room whose host holds no entitlement grant',
        should: 'seat the AI judge and tell the host it is free',
        actual: [
          room.participants.some(
            (p) => p.kind === 'bot' && isJudgeSeat(p.seat),
          ),
          (await f.operations.view(f.host, room.id)).aiJudgeSeating,
        ],
        expected: [true, 'free'],
      });
    } finally {
      await f.sql`delete from agreement_signatures where season_id=${seasonId}`;
      f.afterRooms(async () => {
        await f.sql`delete from seasons where id=${seasonId}`;
      });
    }
  });
});

test('Launch rechecks a casual AI judge seat whose host has since lost the grant', async () => {
  await withRoomRuntime(async (f) => {
    const { actorId: judgeId } = await f.aiJudge();
    let view = await assembleJudgedRoom(f);
    view = (
      await f.command(f.host, view, {
        type: 'assign-seat',
        actorId: judgeId,
        seat: judgeSeat(),
      })
    ).view;
    for (const c of [f.host, f.guest])
      view = (await f.consent(c, view, 'ready')).view;
    await f.sql`delete from account_entitlement_grants where user_id=${f.host.userId} and entitlement='casual_ai_judge'`;
    const refusal = await f.operations
      .command(f.host, view.id, {
        type: 'start-round',
        commandId: createId(),
        expectedVersion: view.version,
      })
      .then(
        () => 'started',
        (error: { message?: string }) => error.message,
      );
    assert({
      given: 'a cast complete and Ready, and a host who lost the grant',
      should: 'refuse the Launch with the plain premium refusal',
      actual: refusal,
      expected: 'ai-judge-premium',
    });
  });
});

test('a ballot that exists reads the same after the host loses the casual AI judge grant', async () => {
  await withRoomRuntime(
    async (f) => {
      const { roundId, target } = await freezeBotJudge(f);
      await seedSettledAttendanceLedger(f, roundId);
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
        fixtureBallot('An AI ballot already written.', 'affirmative'),
        { inputTokens: 1, outputTokens: 1 },
      );
      await createRoundJudgingOperations({
        store: f.store,
        nextId: createId,
        voice: () => {
          throw Error('A saved result never calls the provider');
        },
        withProvider: async () => {
          throw Error('A saved result never acquires the provider');
        },
      }).executeClaim(claim, new AbortController().signal);
      await finalizeByMaintenance(f, roundId);
      const before = await readBallotAs(f, f.host, roundId);
      const removed = await f.sql`
      delete from account_entitlement_grants
      where user_id=${f.host.userId} and entitlement='casual_ai_judge'
      returning entitlement`;
      const after = await readBallotAs(f, f.host, roundId);
      const aiBallots = after.ballots.filter((ballot) => ballot.judge === 'ai');
      assert({
        given:
          'a completed Round with an AI ballot, and its host’s grant withdrawn',
        should: 'return the same ballot read, grant or no grant',
        actual: {
          withdrawn: removed.length,
          status: after.round.status,
          aiBallots: aiBallots.length,
          unchanged: JSON.stringify(after) === JSON.stringify(before),
        },
        expected: {
          withdrawn: 1,
          status: 'completed',
          aiBallots: 1,
          unchanged: true,
        },
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
