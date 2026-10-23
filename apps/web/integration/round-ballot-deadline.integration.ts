import { randomBytes } from 'node:crypto';
import { requireTestServices } from '@daisy/config';
import type { Ballot } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoundBallotOperations } from '../src/features/round-ballots/operations';
import {
  createRoundMaintenanceOperations,
  ROUND_START_HORIZON_MS,
} from '../src/features/round-finalization/maintenance';
import { seedSettledAttendanceLedger } from './round-attendance-fixture.test-support';
import {
  fixtureBallot,
  freezeBotJudge,
  readyTwoHumanJudgeRoom,
} from './round-judging.test-support';
import {
  finalizeAsWeb,
  passBallotDeadline,
} from './round-maintenance.test-support';
import {
  startRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';

setupRitewayBun();
requireTestServices(process.env);
type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
const ruling = (winner: Ballot['winner']) =>
  fixtureBallot('The decisive clash was answered by this side.', winner);

/** A frozen casual Round with two seated human judges and settled attendance. */
async function frozenTwoJudgeRound(f: Fixture) {
  const { room, judges } = await readyTwoHumanJudgeRoom(f);
  const { roundId } = await startRuntimeRound(f, room);
  const initial = (await f.store.getRound(roundId))!;
  const elapsedMs = initial.rules.segments.reduce(
    (total, segment) => total + segment.durationMs + initial.rules.countdownMs,
    125_000,
  );
  await f.sql`update rounds set started_at=clock_timestamp()-${elapsedMs}*interval '1 millisecond' where id=${roundId}`;
  if ((await finalizeAsWeb(f, roundId)).status !== 'frozen')
    throw Error('Expected actual finalizer freeze');
  await seedSettledAttendanceLedger(f, roundId);
  const seats = judges.map((judge) =>
    initial.participants.find((p) => p.actorId === judge.actorId)!,
  );
  return { roundId, judges, seats };
}

/** Production maintenance under fresh web leases. */
async function maintainWith<T>(
  f: Fixture,
  count: number,
  work: (finalize: (roundId: string) => Promise<unknown>[]) => Promise<T>,
) {
  const instances = Array.from({ length: count }, () => createId());
  for (const instanceId of instances)
    await f.store.renewServiceInstance({ instanceId, role: 'web' });
  const operations = instances.map((instanceId) =>
    createRoundMaintenanceOperations({
      startHorizonMs: ROUND_START_HORIZON_MS,
      store: f.store,
      instanceId,
      ids: { next: createId },
      evaluate: async () => null,
    }),
  );
  try {
    return await work((roundId) =>
      operations.map((operation) => operation.finalize(roundId)),
    );
  } finally {
    for (const instanceId of instances)
      await f.sql`delete from service_instances where instance_id=${instanceId}`;
  }
}
const completions = (f: Fixture, roundId: string) =>
  f.sql`select result from round_commands where round_id=${roundId} and type='complete'`;

const submitAs = (
  f: Fixture,
  judge: { readonly actorId: string },
  roundId: string,
  judgeParticipantId: string,
  winner: Ballot['winner'],
) =>
  f.store.getRound(roundId).then((round) =>
    createRoundBallotOperations({
      store: f.store,
      nextBallotId: createId,
      nextSegmentId: createId,
    }).submit({ kind: 'human', actorId: judge.actorId }, roundId, {
      version: 1,
      commandId: createId(),
      expectedVersion: round!.version,
      judgeParticipantId,
      freezeRevision: 1,
      ballot: ruling(winner),
    }),
  );
/** A direct write completing the Round without a winner, refused or accepted at commit. */
const completeDirectly = (
  f: Fixture,
  roundId: string,
  completedAt: 'now' | 'deadline' = 'now',
) =>
  f.sql
    .begin((tx) =>
      completedAt === 'now'
        ? tx`update rounds set status='completed',current_stage=null,outcome=null,completed_at=clock_timestamp() where id=${roundId}`
        : tx`update rounds set status='completed',current_stage=null,outcome=null,completed_at=ballot_deadline_at where id=${roundId}`,
    )
    .then(
      () => 'accepted',
      (error: { constraint?: string }) => error.constraint ?? 'error',
    );

test('a judge who never rules is recorded as no ruling at the persisted deadline and the submitted ballot decides once (DEC-201, DEC-207)', async () => {
  await withRoomRuntime(async (f) => {
    const { roundId, judges, seats } = await frozenTwoJudgeRound(f);
    const [persisted] =
      await f.sql`select r.ballot_deadline_at = z.frozen_at + interval '30 minutes' as exact from rounds r join round_transcript_freezes z on z.round_id=r.id where r.id=${roundId}`;
    const early = [
      await completeDirectly(f, roundId),
      await completeDirectly(f, roundId, 'deadline'),
    ];
    await submitAs(f, judges[0]!, roundId, seats[0]!.id, 'negative');
    await maintainWith(f, 1, (finalize) => Promise.all(finalize(roundId)));
    const waiting = (await f.store.getRound(roundId))!;
    await passBallotDeadline(f.sql, roundId);
    const late = await submitAs(
      f,
      judges[1]!,
      roundId,
      seats[1]!.id,
      'affirmative',
    ).then(
      () => 'accepted',
      (error: { code?: string; message?: string }) =>
        `${error.code} ${error.message}`,
    );
    await maintainWith(f, 2, (finalize) => Promise.all(finalize(roundId)));
    const done = (await f.store.getRound(roundId))!;
    const receipts = await completions(f, roundId);
    assert({
      given:
        'a freeze under the 30-minute policy, a direct completion write and maintenance before the deadline, one ballot, then a late ballot and two instances after it',
      should:
        'persist the deadline, refuse the early write and the late ballot, then complete exactly once from the submitted ballot',
      actual: {
        persisted: persisted.exact,
        early,
        waiting: [waiting.status, waiting.outcome],
        late,
        ballots: (
          await f.sql`select count(*)::int n from ballots where round_id=${roundId}`
        )[0].n,
        done: [done.status, done.outcome],
        receipts: receipts.length,
        ruling: receipts[0]?.result.ruling,
        noRuling: receipts[0]?.result.noRuling,
        ratings: (
          await f.sql`select count(*)::int n from rating_changes where round_id=${roundId}`
        )[0].n,
      },
      expected: {
        persisted: true,
        early: [
          'rounds_unjudged_participants_check',
          'rounds_unjudged_participants_check',
        ],
        waiting: ['active', null],
        late: 'CONFLICT round-decided',
        ballots: 1,
        done: ['completed', 'negative'],
        receipts: 1,
        ruling: 'partial',
        noRuling: [seats[1]!.id],
        ratings: 0,
      },
    });
  });
});

test('when no judge rules by the deadline the Round completes without a winner', async () => {
  await withRoomRuntime(async (f) => {
    const { roundId, seats } = await frozenTwoJudgeRound(f);
    await passBallotDeadline(f.sql, roundId);
    await maintainWith(f, 1, (finalize) => Promise.all(finalize(roundId)));
    const done = (await f.store.getRound(roundId))!;
    const [receipt] = await completions(f, roundId);
    assert({
      given: 'two silent judges past the ballot deadline',
      should:
        "complete with a null outcome and a 'judges did not rule' receipt, never a draw",
      actual: [
        done.status,
        done.outcome,
        receipt?.result.ruling,
        receipt?.result.noRuling,
      ],
      expected: [
        'completed',
        null,
        'judges-did-not-rule',
        seats.map((seat) => seat.id),
      ],
    });
  });
});

test('an AI judging job still open at the deadline is recorded as a known failure', async () => {
  await withRoomRuntime(
    async (f) => {
      const { roundId } = await freezeBotJudge(f);
      await seedSettledAttendanceLedger(f, roundId);
      await passBallotDeadline(f.sql, roundId);
      await maintainWith(f, 1, (finalize) => Promise.all(finalize(roundId)));
      const [job] =
        await f.sql`select status,lease_token_digest from round_judging_jobs where round_id=${roundId}`;
      assert({
        given: 'a queued bot judging job when its ballot deadline passes',
        should: 'complete the Round and fail the job without a lease',
        actual: [(await f.store.getRound(roundId))!.status, job],
        expected: ['completed', { status: 'failed', lease_token_digest: null }],
      });
    },
    {
      botBusyCap: 4,
      judging: {
        leaseMs: 60000,
        model: 'fixture-model',
        nextToken: () => randomBytes(32).toString('base64url'),
      },
    },
  );
});
