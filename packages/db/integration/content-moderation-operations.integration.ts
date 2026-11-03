import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { contentModerationOperations } from '../src/content-moderation-operations';
import { CONTENT_MODERATION_DELIVERY_BOUND_MS } from '@daisy/protocol';
import {
  claimFeedWithdrawal,
  openBroadcast,
} from '../src/broadcast-operations';
import { recordingModeration } from '../src/recording-moderation';
import { recordingOperations } from '../src/recording-operations';
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
          expectedVersion: 1,
          reason: 'legal_request',
        }),
        await run({ action: 'chat_message.remove', messageId: createId() }),
      ],
      expected: ['NOT_FOUND', 'NOT_FOUND', 'NOT_FOUND', 'NOT_FOUND'],
    });
  });
});

test('a Recording takedown ends the feed of its open Broadcast, and a stale one touches neither', async () => {
  await withOps(async (_ops, f, client, roundId) => {
    const ops = contentModerationOperations({
      database: drizzle({ client }) as never,
      recordings: recordingModeration,
    });
    const store = recordingOperations({ database: drizzle({ client }) });
    await openBroadcast(drizzle({ client }), {
      id: createId(),
      roundId,
      feedKey: createId(),
      releasePolicy: { kind: 'delay', seconds: 60 },
    });
    const id = createId();
    await store.requestRecording({
      id,
      roundId,
      class: 'ranked',
      eligibility: { kind: 'ranked' },
    });
    const stoppedAt = async () => {
      const [row] = (await client`select stopped_at, stop_reason from broadcasts
        where round_id=${roundId}`) as {
        stopped_at: unknown;
        stop_reason: string | null;
      }[];
      return row;
    };
    try {
      const change = {
        action: 'recording.takedown',
        recordingId: id,
        reason: 'legal_request',
      };
      await assertRejects({
        given: 'a takedown at a version gone stale',
        should: 'refuse',
        code: 'CONFLICT',
        actual: () =>
          ops.runModerationCommand(
            command({ ...change, expectedVersion: 9 } as never),
          ),
      });
      assert({
        given: 'the refused takedown',
        should: 'write nothing: neither the Recording nor the feed',
        actual: [
          (await store.findRecording(id))?.lifecycle.status,
          (await stoppedAt())?.stopped_at,
        ],
        expected: ['requested', null],
      });
      assert({
        given: 'a takedown at the current version with the feed open',
        should: 'apply, take the Recording down and stop the Broadcast',
        actual: [
          (
            await ops.runModerationCommand(
              command({ ...change, expectedVersion: 1 } as never),
            )
          ).outcome,
          (await store.findRecording(id))?.lifecycle.status,
          (await stoppedAt())?.stop_reason,
        ],
        expected: ['applied', 'taken_down', 'legal_request'],
      });
      assert({
        given: 'the same takedown again from a fresh page',
        should: 'change nothing',
        actual: (
          await ops.runModerationCommand(
            command({ ...change, expectedVersion: 2 } as never),
          )
        ).outcome,
        expected: 'unchanged',
      });
    } finally {
      await client`delete from recordings where id=${id}`;
    }
  });
});

test('an operator or legal removal ends the feed, and only an operator stop withholds the video', async () => {
  await withOps(async (_ops, f, client, roundId) => {
    const database = drizzle({ client });
    const ops = contentModerationOperations({
      database: database as never,
      recordings: recordingModeration,
    });
    const store = recordingOperations({ database });
    const broadcastId = createId();
    await openBroadcast(database, {
      id: broadcastId,
      roundId,
      feedKey: createId(),
      releasePolicy: { kind: 'delay', seconds: 60 },
    });
    const id = createId();
    await store.requestRecording({
      id,
      roundId,
      class: 'ranked',
      eligibility: { kind: 'ranked' },
    });
    const feed = async () => {
      const [row] =
        (await client`select stop_reason, media_withheld from broadcasts
        where id=${broadcastId}`) as {
          stop_reason: string | null;
          media_withheld: boolean;
        }[];
      return [row?.stop_reason, row?.media_withheld];
    };
    const legal = {
      action: 'recording.legal_remove',
      recordingId: id,
      expectedVersion: 1,
      reason: 'court_order',
    };
    try {
      assert({
        given: 'a legal removal with the feed open',
        should: 'apply, end the feed and withhold nothing',
        actual: [
          (await ops.runModerationCommand(command(legal as never))).outcome,
          ...(await feed()),
        ],
        expected: ['applied', 'recording_legally_removed', false],
      });
      assert({
        given: 'an operator stopping that Broadcast afterwards',
        should: 'hold the video back, the stop reason standing',
        actual: [
          (
            await ops.runModerationCommand(
              command({
                action: 'broadcast.stop',
                broadcastId,
                reason: 'technical',
              } as never),
            )
          ).outcome,
          ...(await feed()),
        ],
        expected: ['applied', 'recording_legally_removed', true],
      });
      assert({
        given: 'the same stop again',
        should: 'change nothing',
        actual: (
          await ops.runModerationCommand(
            command({
              action: 'broadcast.stop',
              broadcastId,
              reason: 'technical',
            } as never),
          )
        ).outcome,
        expected: 'unchanged',
      });
    } finally {
      await client`delete from recordings where id=${id}`;
    }
    const round = await f.round();
    const second = createId();
    await openBroadcast(database, {
      id: second,
      roundId: round,
      feedKey: createId(),
      releasePolicy: { kind: 'delay', seconds: 60 },
    });
    await client`update broadcasts set completed_at=now() where id=${second}`;
    const removed = createId();
    await store.requestRecording({
      id: removed,
      roundId: round,
      class: 'casual',
      eligibility: { kind: 'host_opt_in', hostActorId: 'a'.repeat(24) },
    });
    try {
      assert({
        given: 'a legal removal just after the Broadcast completed',
        should: 'ask for its feed to be withdrawn at once',
        actual: [
          (
            await ops.runModerationCommand(
              command({
                action: 'recording.legal_remove',
                recordingId: removed,
                expectedVersion: 1,
                reason: 'court_order',
              } as never),
            )
          ).outcome,
          (
            (await client`select feed_withdrawal_requested_at is not null as asked
              from broadcasts where id=${second}`) as { asked: boolean }[]
          )[0]?.asked,
        ],
        expected: ['applied', true],
      });
    } finally {
      await client`delete from recordings where id=${removed}`;
      await client`delete from broadcasts where id=${second}`;
    }
  });
});

test('a takedown just after a Broadcast completed withdraws its feed now, not after the grace', async () => {
  await withOps(async (_ops, _f, client, roundId) => {
    const database = drizzle({ client });
    const ops = contentModerationOperations({
      database: database as never,
      recordings: recordingModeration,
    });
    const store = recordingOperations({ database });
    const broadcast = await openBroadcast(database, {
      id: createId(),
      roundId,
      feedKey: createId(),
      releasePolicy: { kind: 'delay', seconds: 60 },
    });
    const id = createId();
    await store.requestRecording({
      id,
      roundId,
      class: 'ranked',
      eligibility: { kind: 'ranked' },
    });
    const now = new Date();
    await client`update broadcasts set completed_at=${now.toISOString()}::timestamptz,
        final_media_end_at=${now.toISOString()}::timestamptz where id=${broadcast.id}`;
    const claim = () =>
      database.transaction((tx) =>
        claimFeedWithdrawal(tx, {
          owner: 'w',
          now,
          leaseUntil: new Date(now.getTime() + 30_000),
          withdrawFinishedBefore: new Date(
            now.getTime() - CONTENT_MODERATION_DELIVERY_BOUND_MS,
          ),
        }),
      );
    const claimedThis = async () => (await claim())?.id === broadcast.id;
    try {
      assert({
        given: 'a Broadcast that completed this instant',
        should: 'wait out its grace, as a finished feed does',
        actual: await claimedThis(),
        expected: false,
      });
      assert({
        given: 'a takedown of its Recording',
        should: 'apply, and not pretend the completed Broadcast was stopped',
        actual: [
          (
            await ops.runModerationCommand(
              command({
                action: 'recording.takedown',
                recordingId: id,
                expectedVersion: 1,
                reason: 'legal_request',
              } as never),
            )
          ).outcome,
          (
            (await client`select stopped_at from broadcasts where id=${broadcast.id}`) as {
              stopped_at: unknown;
            }[]
          )[0]?.stopped_at,
        ],
        expected: ['applied', null],
      });
      assert({
        given: 'the very next poll of the withdrawal loop, the grace unspent',
        should: 'claim the feed, so it goes within the delivery bound',
        actual: await claimedThis(),
        expected: true,
      });
      const stored = await store.findRecording(id);
      assert({
        given: 'the stored Recording',
        should: 'keep the closed takedown reason',
        actual:
          stored?.lifecycle.status === 'taken_down'
            ? stored.lifecycle.reason
            : null,
        expected: 'legal_request',
      });
    } finally {
      await client`delete from recordings where id=${id}`;
    }
  });
});

test('a failed ranked Recording rebuilds, and an evidence hold yields only to a legal removal', async () => {
  await withOps(async (_ops, f, client, roundId) => {
    const database = drizzle({ client });
    const ops = contentModerationOperations({
      database: database as never,
      recordings: recordingModeration,
    });
    const store = recordingOperations({ database });
    const at = '2026-11-03T10:00:00.000Z';
    const capture = {
      source: { kind: 'own_capture' as const },
      startedAt: at,
      attempts: [{ attempt: 2, egressId: 'EG', startedAt: at }],
      endedAt: '2026-11-03T11:20:00.000Z',
    };
    const make = async (round: string, recordingClass: 'ranked' | 'casual') => {
      const id = createId();
      await store.requestRecording({
        id,
        roundId: round,
        class: recordingClass,
        eligibility:
          recordingClass === 'ranked'
            ? { kind: 'ranked' }
            : { kind: 'host_opt_in', hostActorId: 'a'.repeat(24) },
      });
      return id;
    };
    const run = (change: object) =>
      ops.runModerationCommand(command(change as never));
    const ranked = await make(roundId, 'ranked');
    const held = await make(await f.round(), 'casual');
    try {
      await client`insert into recording_processing_jobs
          (recording_id, hold_prefix, status, state, runs_started)
        values (${ranked}, 'hold/r/', 'failed',
          ${JSON.stringify({ status: 'failed', reason: 'processing_failed', failedAt: at })}::text::jsonb, 5)`;
      await store.applyRecording(ranked, () => ({
        kind: 'moved',
        next: {
          status: 'failed',
          reason: 'processing_failed',
          failedAt: at,
          capture,
        },
      }));
      assert({
        given: 'the failed Recordings list',
        should: 'offer the ranked one with its version',
        actual: (await ops.listRebuildableRecordings()).find(
          (item) => item.recordingId === ranked,
        )?.version,
        expected: 2,
      });
      await assertRejects({
        given: 'a rebuild at a stale version',
        should: 'refuse',
        code: 'CONFLICT',
        actual: () =>
          run({
            action: 'recording.rebuild',
            recordingId: ranked,
            expectedVersion: 1,
          }),
      });
      assert({
        given: 'a rebuild at the current version',
        should: 'go back to processing and queue it afresh, for every attempt',
        actual: [
          (
            await run({
              action: 'recording.rebuild',
              recordingId: ranked,
              expectedVersion: 2,
            })
          ).outcome,
          (await store.findRecording(ranked))?.lifecycle.status,
          (
            (await client`select status, runs_started, state from recording_processing_jobs
              where recording_id=${ranked}`) as {
              status: string;
              runs_started: number;
              state: unknown;
            }[]
          )[0],
        ],
        expected: [
          'applied',
          'processing',
          {
            status: 'queued',
            runs_started: 0,
            // 80 minutes: a 45 minute bound, so a 135 minute ceiling.
            state: {
              status: 'queued',
              attemptCount: 2,
              ceilingMs: 135 * 60_000,
              publicIntervals: [],
            },
          },
        ],
      });

      const noSources = await make(await f.round(), 'ranked');
      await client`insert into recording_processing_jobs
          (recording_id, hold_prefix, status, state)
        values (${noSources}, 'hold/n/', 'settled',
          ${JSON.stringify({ status: 'settled', settledAt: at })}::text::jsonb)`;
      await store.applyRecording(noSources, () => ({
        kind: 'moved',
        next: {
          status: 'failed',
          reason: 'processing_failed',
          failedAt: at,
          capture,
        },
      }));
      await assertRejects({
        given: 'a rebuild whose sources are gone',
        should: 'refuse',
        code: 'CONFLICT',
        actual: () =>
          run({
            action: 'recording.rebuild',
            recordingId: noSources,
            expectedVersion: 2,
          }),
      });
      assert({
        given: 'that refusal',
        should: 'leave it failed, not processing with nothing to build',
        actual: (await store.findRecording(noSources))?.lifecycle.status,
        expected: 'failed',
      });
      await client`delete from recording_processing_jobs where recording_id=${noSources}`;
      await client`delete from recordings where id=${noSources}`;

      await store.applyRecording(held, () => ({
        kind: 'moved',
        next: {
          status: 'taken_down',
          takenDownAt: at,
          reason: 'policy_violation',
          held: null,
          removalOwed: {
            requestedAt: at,
            heldUntil: '2027-02-01T10:00:00.000Z',
          },
        },
      }));
      await assertRejects({
        given: 'an ordinary moderation removal of a Recording held as evidence',
        should: 'refuse',
        code: 'CONFLICT',
        actual: () =>
          run({
            action: 'recording.remove',
            recordingId: held,
            expectedVersion: 2,
          }),
      });
      assert({
        given: 'a legal removal of the same',
        should: 'go, whatever the hold says',
        actual: [
          (
            await run({
              action: 'recording.legal_remove',
              recordingId: held,
              expectedVersion: 2,
              reason: 'court_order',
            })
          ).outcome,
          (await store.findRecording(held))?.lifecycle,
        ].map((value) =>
          typeof value === 'object' && value !== null && 'cause' in value
            ? value.cause
            : value,
        ),
        expected: ['applied', 'legal_removal'],
      });
    } finally {
      await client`delete from recording_processing_jobs where recording_id=${ranked}`;
      await client`delete from recordings where id in (${ranked}, ${held})`;
    }
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
