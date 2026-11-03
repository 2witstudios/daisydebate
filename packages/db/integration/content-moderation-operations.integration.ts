import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { contentModerationOperations } from '../src/content-moderation-operations';
import { openBroadcast } from '../src/broadcast-operations';
import { withFixture, type Fixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const head = 'a'.repeat(64);
const withOps = async (
  run: (
    ops: ReturnType<typeof contentModerationOperations>,
    f: Fixture,
    client: SQL,
    roundId: string,
  ) => Promise<void>,
) => {
  const client = new SQL(databaseUrl, { max: 4 });
  const ids: string[] = [];
  try {
    await withFixture(databaseUrl, async (f) => {
      const roundId = await f.round();
      ids.push(roundId);
      try {
        await run(
          contentModerationOperations({
            database: drizzle({ client }) as never,
          }),
          f,
          client,
          roundId,
        );
      } finally {
        await client`delete from operator_command_receipts where admin_audit_head=${head}`;
        await client`delete from content_reports where target_id=${roundId}`;
        await client`delete from broadcasts where round_id=${roundId}`;
      }
    });
  } finally {
    await client.close();
  }
};

const command = (change: never, overrides: object = {}) => ({
  commandId: createId(),
  serviceId: 'daisy-admin',
  operatorRef: 'o'.repeat(24),
  requestDigest: 'd'.repeat(64),
  adminAuditHead: head,
  live: () => true,
  change,
  ...overrides,
});

test('a report files once, and the queue names no reporter', async () => {
  await withOps(async (ops, f, client, roundId) => {
    const userId = await f.user();
    const report = {
      targetKind: 'round',
      targetId: roundId,
      reason: 'spam',
    } as const;
    const file = (id: string) =>
      ops.fileReport({
        id,
        reporterUserId: userId,
        reporterActorId: 'a'.repeat(24),
        report,
      });
    await file(createId());
    await file(createId());
    const page = await ops.listModerationReports({
      queue: 'safety',
      status: 'open',
      limit: 10,
      after: null,
    });
    const mine = page.filter((row) => row.targetId === roundId);
    assert({
      given: 'the same report twice',
      should: 'keep one, with no reporter in the row the operator reads',
      actual: [mine.length, Object.keys(mine[0]!).includes('reporterUserId')],
      expected: [1, false],
    });
    await client`delete from content_reports where reporter_user_id=${userId}`;
  });
});

test('a dispute goes to the review queue, and resolving it stands', async () => {
  await withOps(async (ops, f, _client, roundId) => {
    const id = createId();
    await ops.fileReport({
      id,
      reporterUserId: await f.user(),
      reporterActorId: 'a'.repeat(24),
      report: {
        targetKind: 'round',
        targetId: roundId,
        reason: 'result_dispute',
      },
    });
    const review = await ops.listModerationReports({
      queue: 'review',
      status: 'open',
      limit: 10,
      after: null,
    });
    const resolve = (outcome: 'upheld' | 'dismissed', requestDigest: string) =>
      ops.runModerationCommand(
        command(
          { action: 'content_report.resolve', reportId: id, outcome } as never,
          {
            requestDigest,
          },
        ),
      );
    const first = await resolve('upheld', 'a'.repeat(64));
    const second = await resolve('dismissed', 'b'.repeat(64));
    const detail = await ops.readModerationReport(id);
    assert({
      given: 'a dispute, an upheld resolution, and a later dismissal',
      should: 'list it for review and keep the first resolution',
      actual: [
        review.some((row) => row.reportId === id),
        first.outcome,
        second.outcome,
        detail?.report.status,
        detail?.subject?.kind,
      ],
      expected: [true, 'applied', 'unchanged', 'upheld', 'round'],
    });
  });
});

test('a stop replays by its receipt, and a reused id with another digest conflicts', async () => {
  await withOps(async (ops, _f, client, roundId) => {
    const broadcast = await openBroadcast(drizzle({ client }), {
      id: createId(),
      roundId,
      feedKey: createId(),
      releasePolicy: { kind: 'delay', seconds: 60 },
    });
    const stop = command({
      action: 'broadcast.stop',
      broadcastId: broadcast.id,
      reason: 'technical',
    } as never);
    const first = await ops.runModerationCommand(stop);
    const replay = await ops.runModerationCommand(stop);
    const conflict = await ops
      .runModerationCommand({ ...stop, requestDigest: 'e'.repeat(64) })
      .then(
        () => 'applied',
        (error: { code: string }) => error.code,
      );
    const [row] =
      await client`select stop_reason from broadcasts where id=${broadcast.id}`;
    const [receipt] =
      await client`select target_user_id from operator_command_receipts where command_id=${stop.commandId}`;
    assert({
      given: 'a stop, its replay, and its id reused for something else',
      should: 'apply once, replay the result, conflict, and target no account',
      actual: [
        first.outcome,
        replay.outcome,
        conflict,
        row.stop_reason,
        receipt.target_user_id,
      ],
      expected: ['applied', 'applied', 'CONFLICT', 'technical', null],
    });
  });
});

test('a command past its deadline writes nothing', async () => {
  await withOps(async (ops, _f, client, roundId) => {
    const broadcast = await openBroadcast(drizzle({ client }), {
      id: createId(),
      roundId,
      feedKey: createId(),
      releasePolicy: { kind: 'delay', seconds: 60 },
    });
    const late = await ops
      .runModerationCommand(
        command(
          {
            action: 'broadcast.stop',
            broadcastId: broadcast.id,
            reason: 'technical',
          } as never,
          { live: () => false },
        ),
      )
      .then(
        () => 'applied',
        (error: { code: string }) => error.code,
      );
    const [row] =
      await client`select stopped_at from broadcasts where id=${broadcast.id}`;
    assert({
      given: 'a stop whose signed deadline passed during the transaction',
      should: 'conflict and leave the Broadcast running',
      actual: [late, row.stopped_at],
      expected: ['CONFLICT', null],
    });
  });
});

test('slow mode and bans are what chat reads', async () => {
  await withOps(async (ops, f, client, roundId) => {
    const broadcast = await openBroadcast(drizzle({ client }), {
      id: createId(),
      roundId,
      feedKey: createId(),
      releasePolicy: { kind: 'delay', seconds: 60 },
    });
    const userId = await f.user();
    const facts = () =>
      ops.readChatPostFacts({ userId, broadcastId: broadcast.id });
    const before = await facts();
    const run = (change: unknown) =>
      ops.runModerationCommand(command(change as never));
    const slow = await run({
      action: 'broadcast.chat_slow_mode.update',
      broadcastId: broadcast.id,
      seconds: 30,
    });
    const ban = await run({
      action: 'account.audience_ban.update',
      userId,
      state: 'banned',
    });
    const banAgain = await run({
      action: 'account.audience_ban.update',
      userId,
      state: 'banned',
    });
    const during = await facts();
    const lift = await run({
      action: 'account.audience_ban.update',
      userId,
      state: 'lifted',
    });
    const after = await facts();
    assert({
      given: 'slow mode set, a ban, its repeat, and its lift',
      should: 'show each in the facts chat decides from',
      actual: [
        before,
        slow.outcome,
        ban.outcome,
        banAgain.outcome,
        during,
        lift.outcome,
        after,
      ],
      expected: [
        { banned: false, slowModeSeconds: 0 },
        'applied',
        'applied',
        'unchanged',
        { banned: true, slowModeSeconds: 30 },
        'applied',
        { banned: false, slowModeSeconds: 30 },
      ],
    });
  });
});

test('a target that is not there answers not found and writes nothing', async () => {
  await withOps(async (ops) => {
    const run = (change: unknown) =>
      ops.runModerationCommand(command(change as never)).then(
        () => 'applied',
        (error: { code: string }) => error.code,
      );
    assert({
      given: 'an unknown Broadcast, account, Recording and chat message',
      should: 'refuse each, since their owners have nothing there',
      actual: [
        await run({
          action: 'broadcast.stop',
          broadcastId: createId(),
          reason: 'technical',
        }),
        await run({
          action: 'account.audience_ban.update',
          userId: createId(),
          state: 'banned',
        }),
        await run({
          action: 'recording.takedown',
          recordingId: createId(),
          reason: 'legal_request',
        }),
        await run({ action: 'chat_message.remove', messageId: createId() }),
      ],
      expected: ['NOT_FOUND', 'NOT_FOUND', 'NOT_FOUND', 'NOT_FOUND'],
    });
  });
});

test('only the debater who received feedback can report it, and the operator reads that side alone', async () => {
  await withOps(async (ops, f, client, roundId) => {
    const debater = await f.seat(roundId, 'affirmative');
    const opponent = await f.seat(roundId, 'negative');
    const judge = await f.seat(roundId, 'judge');
    const revision = await f.freeze(roundId);
    const ballotId = createId();
    await client`insert into ballots (id, judge_participant_id, round_id, freeze_revision,
        rubric_version, winner, scores, reason, feedback, submitted_at)
      values (${ballotId}, ${judge.id}, ${roundId}, ${revision}, 'speaker-10@1',
        'affirmative', ${JSON.stringify({})}::text::jsonb, 'Reason',
        ${JSON.stringify({ affirmative: 'For aff', negative: 'For neg' })}::text::jsonb,
        now())`;
    try {
      const facts = (actorId: string) =>
        ops.readReportTargetFacts({
          reporterUserId: 'u'.repeat(24),
          reporterActorId: actorId,
          report: {
            targetKind: 'ballot_feedback',
            targetId: ballotId,
            reason: 'abusive_feedback',
          },
        });
      const stranger = await f.actor();
      const [fromDebater, fromStranger, fromJudge] = [
        await facts(debater.actorId),
        await facts(stranger),
        await facts(judge.actorId),
      ];
      const id = createId();
      await ops.fileReport({
        id,
        reporterUserId: await f.user(),
        reporterActorId: opponent.actorId,
        report: {
          targetKind: 'ballot_feedback',
          targetId: ballotId,
          reason: 'abusive_feedback',
        },
      });
      const detail = await ops.readModerationReport(id);
      assert({
        given: 'the debater, a stranger, the judge, then the opponent’s report',
        should: 'admit only debaters, and show the opponent’s side alone',
        actual: [fromDebater, fromStranger, fromJudge, detail?.subject],
        expected: [
          { kind: 'ballot_feedback', feedbackIsForReporter: true },
          { kind: 'ballot_feedback', feedbackIsForReporter: false },
          { kind: 'ballot_feedback', feedbackIsForReporter: false },
          {
            kind: 'ballot_feedback',
            ballotId,
            side: 'negative',
            text: 'For neg',
          },
        ],
      });
    } finally {
      await client`delete from content_reports where target_id=${ballotId}`;
      await client`delete from ballots where id=${ballotId}`;
    }
  });
});
