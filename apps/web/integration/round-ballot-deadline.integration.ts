import { randomBytes } from 'node:crypto';
import { requireTestServices } from '@daisy/config';
import {
  oneOnOneDefinition,
  practiceRoomConfig,
} from '@daisy/db/reference-formats';
import { ballotCategories, type Ballot } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoundBallotOperations } from '../src/features/round-ballots/operations';
import { createRoundMaintenanceOperations } from '../src/features/round-finalization/maintenance';
import { seedSettledAttendanceLedger } from './round-attendance-fixture.test-support';
import { freezeBotJudge } from './round-judging.test-support';
import { finalizeAsWeb } from './round-maintenance.test-support';
import {
  startRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';

setupRitewayBun();
requireTestServices(process.env);
type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
const ruling = (winner: Ballot['winner']): Ballot => ({
  rubricVersion: 'speaker-10@1',
  winner,
  reason: 'The decisive clash was answered by this side.',
  feedback: {},
  scores: {
    affirmative: Object.fromEntries(ballotCategories.map((key) => [key, 3])),
    negative: Object.fromEntries(ballotCategories.map((key) => [key, 3])),
  } as Ballot['scores'],
});

/** A frozen casual Round with two seated human judges and settled attendance. */
async function frozenTwoJudgeRound(f: Fixture) {
  const secondJudge = await f.member();
  let room = await f.assemble({
    selection: {
      kind: 'custom',
      definition: {
        ...oneOnOneDefinition,
        seats: { ...oneOnOneDefinition.seats, judge: 2 },
      },
      config: practiceRoomConfig,
      length: 'full',
      competitionType: 'casual',
    },
  });
  const judges = [f.outsider, secondJudge];
  for (const [slot, judge] of judges.entries())
    room = (
      await f.command(judge, room, { type: 'claim-seat', role: 'judge', slot })
    ).view;
  for (const caller of [f.host, f.guest, ...judges])
    room = (
      await f.consent(caller, await f.operations.view(caller, room.id), 'ready')
    ).view;
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

/** Production maintenance under fresh web leases, with the deadline policy injected. */
async function maintainWith<T>(
  f: Fixture,
  ballotDeadlineMs: number,
  count: number,
  work: (finalize: (roundId: string) => Promise<unknown>[]) => Promise<T>,
) {
  const instances = Array.from({ length: count }, () => createId());
  for (const instanceId of instances)
    await f.store.renewServiceInstance({ instanceId, role: 'web' });
  const operations = instances.map((instanceId) =>
    createRoundMaintenanceOperations({
      store: f.store,
      instanceId,
      ids: { next: createId },
      evaluate: async () => null,
      ballotDeadlineMs,
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

test('a judge who never rules is recorded as no ruling at the deadline and the submitted ballot decides once (DEC-201)', async () => {
  await withRoomRuntime(async (f) => {
    const { roundId, judges, seats } = await frozenTwoJudgeRound(f);
    const before = (await f.store.getRound(roundId))!;
    await createRoundBallotOperations({
      store: f.store,
      nextBallotId: createId,
      nextSegmentId: createId,
    }).submit({ kind: 'human', actorId: judges[0]!.actorId }, roundId, {
      version: 1,
      commandId: createId(),
      expectedVersion: before.version,
      judgeParticipantId: seats[0]!.id,
      freezeRevision: 1,
      ballot: ruling('negative'),
    });
    await maintainWith(f, 30 * 60_000, 1, (finalize) =>
      Promise.all(finalize(roundId)),
    );
    const waiting = (await f.store.getRound(roundId))!;
    await maintainWith(f, 0, 2, (finalize) => Promise.all(finalize(roundId)));
    const done = (await f.store.getRound(roundId))!;
    const receipts = await completions(f, roundId);
    assert({
      given:
        'one of two judges ruled, maintenance inside the default 30-minute deadline, then two instances past it',
      should:
        'wait, then complete exactly once with the submitted outcome and the silent judge as no ruling',
      actual: {
        waiting: [waiting.status, waiting.outcome],
        done: [done.status, done.outcome],
        receipts: receipts.length,
        ruling: receipts[0]?.result.ruling,
        noRuling: receipts[0]?.result.noRuling,
        ratings: (
          await f.sql`select count(*)::int n from rating_changes where round_id=${roundId}`
        )[0].n,
      },
      expected: {
        waiting: ['active', null],
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
    await maintainWith(f, 0, 1, (finalize) => Promise.all(finalize(roundId)));
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
      await maintainWith(f, 0, 1, (finalize) => Promise.all(finalize(roundId)));
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
