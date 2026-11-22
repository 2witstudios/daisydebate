import { createAppError } from '@daisy/errors';
import { runRecordingWithdrawalCommand } from '../src/features/operator-api/recording-withdrawal-command';
import type { ContentModerationChange } from '../src/features/operator-api/content-moderation';
import { api, signed } from '../src/features/operator-api/router.test-support';
import { instantMs } from '@daisy/clock';
import { spectatorClockAt } from '../src/features/spectating/spectator-clock';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import {
  oneOnOneDefinition,
  oneOnOneSettings,
} from '@daisy/db/reference-formats';
import { CONTENT_MODERATION_DELIVERY_BOUND_MS } from '@daisy/protocol/content-moderation';
import { isJudgeSeat, isModeratorSeat } from '@daisy/protocol/seats';
import { plannedRecording } from '@daisy/debate-engine';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { audienceLinkHash } from '../src/features/audience-link/audience-link';
import type { RecordingViewer } from '../src/features/recording/audience';
import { createRecordingCapturePort } from '../src/features/recording/capture-port';
import {
  REMOVAL_SETTLE_MS,
  runDeletionSweep,
} from '../src/features/recording/deletion-sweep';
import { openDownload } from '../src/features/recording/download';
import { fakeObjectStore } from '../src/features/recording/fake-store.test-support';
import { openRecordingHistory } from '../src/features/recording/history';
import { recordingPersistence } from '../src/features/recording/persistence';
import { openPlayback } from '../src/features/recording/playback';
import type { RecordingInputs } from '../src/features/recording/ports';
import { requestParticipantRemoval } from '../src/features/recording/removal';
import { launchRuntimeRound } from './round-runtime.test-support';
import { withRoomRuntime } from './room-runtime.test-support';

setupRitewayBun();
requireTestServices(process.env);

type RunModerationCommand = Parameters<
  typeof recordingPersistence
>[0]['database']['runModerationCommand'];

const AUDIT_HEAD = 'b'.repeat(64);
const at = '2026-11-02T10:00:00.000Z';
const nowMs = instantMs(at);

/** A real launched Round with a real Recording, ready, through the capture port. */
const withReadyRecording = (
  run: (input: {
    store: ReturnType<typeof recordingPersistence>;
    database: Parameters<typeof recordingPersistence>[0]['database'];
    inputs: RecordingInputs;
    id: string;
    roundId: string;
    sql: Parameters<Parameters<typeof withRoomRuntime>[0]>[0]['sql'];
    seat: RecordingViewer;
    stranger: RecordingViewer;
    keys: readonly string[];
    /** A moderation command down the production path: the operator store's. */
    moderate: (
      change: ContentModerationChange,
    ) => ReturnType<RunModerationCommand>;
  }) => Promise<void>,
  status: 'completed' | 'abandoned' = 'completed',
) =>
  withRoomRuntime(async (f) => {
    const room = await f.assemble({
      selection: {
        kind: 'custom',
        definition: {
          ...oneOnOneDefinition,
          seats: { ...oneOnOneDefinition.seats, judges: 0 },
        },
        competitionType: 'casual',
        config: oneOnOneSettings,
      },
    });
    const { roundId } = await launchRuntimeRound(f, room);
    await f.sql`update rounds set status=${status}, current_stage=null, started_at=${at}::timestamptz, completed_at=${at}::timestamptz where id=${roundId}`;
    const database = f.store as never as Parameters<
      typeof recordingPersistence
    >[0]['database'];
    const store = recordingPersistence({ database });
    const read = await database.readRecordingRound(roundId);
    const base: Omit<RecordingInputs, 'readRoundFresh'> = {
      readRound: async (id) => {
        const round = await database.readRecordingRound(id);
        return (
          round && {
            id: round.id,
            competitionType: round.competitionType,
            visibility: round.visibility,
            audienceLinkHash: round.audienceLinkHash,
            hostActorId: round.hostActorId,
            completedAtMs: round.completedAtMs,
            seatedActorIds: round.seats.map((seat) => seat.actorId),
            recordingPolicy: plannedRecording(round),
            officialActorIds: round.seats
              .filter(
                (seat) => isJudgeSeat(seat.seat) || isModeratorSeat(seat.seat),
              )
              .map((seat) => seat.actorId),
            youth: null,
          }
        );
      },
      readBroadcastRelease: (roundId: string) =>
        database.readRecordingBroadcastRelease(
          roundId,
          spectatorClockAt(new Date().toISOString()),
        ),
      readFloorIntervals: database.readRecordingFloorIntervals,
      readCoverageFacts: database.readRecordingCoverageFacts,
      holdsRecordingDownload: async () => true,
      readReuseFenced: async () => false,
    };
    const inputs: RecordingInputs = { ...base, readRoundFresh: base.readRound };
    const port = createRecordingCapturePort({
      store,
      inputs,
      nextId: createId,
    });
    const record = await port.request({
      roundId,
      competitionType: 'casual',
      youthRound: false,
      hostActorId: read!.hostActorId,
      hostOptedIn: true,
      hostHoldsRecording: true,
    });
    const id = record!.id;
    const prefix = `recordings/${id}/`;
    await port.captureStarted(id, {
      source: { kind: 'own_capture' },
      attempt: 1,
      egressId: 'EG',
      at,
    });
    await port.captureEnded(id, { at });
    await port.mediaVerified(id, {
      capturedFrom: at,
      playlistKey: `${prefix}hls/master.m3u8`,
      downloadKey: `${prefix}video.mp4`,
      durationMs: 60_000,
      byteSize: 10,
      verifiedAt: at,
      gaps: [],
    });
    const seatActor = read!.seats[0]!.actorId;
    try {
      await run({
        store,
        database,
        inputs,
        id,
        roundId,
        sql: f.sql,
        seat: { kind: 'account', userId: 'seat-user', actorId: seatActor },
        stranger: { kind: 'account', userId: 'other', actorId: createId() },
        keys: [`${prefix}hls/master.m3u8`, `${prefix}video.mp4`],
        moderate: (change) => {
          const input = {
            commandId: createId(),
            serviceId: 'daisy-admin',
            operatorRef: 'o'.repeat(24),
            requestDigest: 'd'.repeat(64),
            adminAuditHead: AUDIT_HEAD,
            live: () => true,
          };
          return change.action === 'recording.takedown' ||
            change.action === 'recording.remove' ||
            change.action === 'recording.legal_remove'
            ? runRecordingWithdrawalCommand(database, { ...input, change })
            : database.runModerationCommand({ ...input, change });
        },
      });
    } finally {
      await f.sql`delete from operator_command_receipts where admin_audit_head=${AUDIT_HEAD}`;
      await f.sql`delete from recordings where id=${id}`;
    }
  });

test('an unlisted Recording opens only past its current link', async () => {
  await withReadyRecording(
    async ({ store, inputs, id, roundId, sql, stranger }) => {
      const objects = fakeObjectStore().store;
      const deps = { store, objects, inputs };
      await sql`update rooms set visibility='unlisted' where id=(select room_id from rounds where id=${roundId})`;
      await sql`update rounds set visibility='unlisted' where id=${roundId}`;
      const broadcastId = createId();
      await sql`insert into broadcasts (id, round_id, feed_key, release_policy, released_through_at)
        values (${broadcastId}, ${roundId}, ${createId()}, ${{ kind: 'delay', seconds: 60 }}, ${at}::timestamptz + interval '1 hour')`;
      const history = (presentedLinkHash: string | null) =>
        inputs.readRound(roundId).then((round) =>
          openRecordingHistory(
            {
              readJobState: async () => null,
              nowMs: () => nowMs,
              readHistoryRound: async () => ({
                ...round!,
                title: 'Round',
                resolution: 'x',
                ladder: null,
                sides: [],
                outcome: null,
                debaters: [],
              }),
              readBroadcastRelease: inputs.readBroadcastRelease,
              readTranscript: async () => null,
              readBallots: async () => [],
              holdsRecordingDownload: inputs.holdsRecordingDownload,
              readReuseFenced: inputs.readReuseFenced,
              findRecordingByRound: store.findByRound,
            },
            { roundId, viewer: stranger, presentedLinkHash, q: '' },
          ),
        );
      const play = (link: string | null) =>
        openPlayback(deps, {
          recordingId: id,
          path: ['master.m3u8'],
          viewer: stranger,
          presentedLinkHashOf: () => link,
          nowMs,
        });
      const download = (link: string | null) =>
        openDownload(deps, {
          recordingId: id,
          viewer: stranger,
          presentedLinkHashOf: () => link,
          nowMs,
        });
      const first = audienceLinkHash('first-link');
      const second = audienceLinkHash('second-link');
      try {
        assert({
          given: 'no link has been issued',
          should: 'read as a missing Recording',
          actual: (await history(null)).kind,
          expected: 'unavailable',
        });
        await assertRejects({
          given: 'playback with no link',
          should: 'answer not found',
          code: 'NOT_FOUND',
          actual: () => play(null),
        });
        await sql`update rounds set audience_link_hash=${first} where id=${roundId}`;
        assert({
          given: 'a real unlisted Round and its current link',
          should: 'open the Recording, and refuse no link and a wrong one',
          actual: [
            (await history(first)).kind,
            (await history(null)).kind,
            (await history(second)).kind,
          ],
          expected: ['history', 'unavailable', 'unavailable'],
        });
        await assertRejects({
          given: 'a download by a member with no link',
          should: 'answer not found',
          code: 'NOT_FOUND',
          actual: () => download(null),
        });
        await sql`update rounds set audience_link_hash=${second} where id=${roundId}`;
        assert({
          given: 'the link replaced',
          should: 'refuse the old one on the next read, and open the new one',
          actual: [(await history(first)).kind, (await history(second)).kind],
          expected: ['unavailable', 'history'],
        });
        await assertRejects({
          given: 'playback with the replaced link',
          should: 'answer not found',
          code: 'NOT_FOUND',
          actual: () => play(first),
        });
      } finally {
        await sql`delete from broadcasts where id=${broadcastId}`;
      }
    },
  );
});

test('a Recording taken down during an open Broadcast comes back to its audience on restore', async () => {
  await withReadyRecording(
    async ({ store, inputs, id, roundId, sql, stranger, moderate }) => {
      const deps = { store, objects: fakeObjectStore().store, inputs };
      await sql`update rooms set visibility='public' where id=(select room_id from rounds where id=${roundId})`;
      await sql`update rounds set visibility='public' where id=${roundId}`;
      const broadcastId = createId();
      await sql`insert into broadcasts (id, round_id, feed_key, release_policy, released_through_at)
        values (${broadcastId}, ${roundId}, ${createId()}, ${{ kind: 'delay', seconds: 60 }}, ${at}::timestamptz + interval '1 hour')`;
      const play = () =>
        openPlayback(deps, {
          recordingId: id,
          path: ['720p', 'seg.ts'],
          viewer: stranger,
          presentedLinkHashOf: () => null,
          nowMs,
        });
      const listed = async () =>
        (
          await store.listArchive({
            query: {
              scope: 'all',
              mode: 'any',
              q: '',
              sort: 'newest',
              before: '',
            },
            viewerActorId: null,
            clock: spectatorClockAt(new Date().toISOString()),
            limit: 50,
          })
        ).rows
          .filter((row) => row.id === roundId)
          .map((row) => row.release.stop);
      try {
        assert({
          given: 'a takedown with the feed open',
          should: 'apply',
          actual: await moderate({
            action: 'recording.takedown',
            recordingId: id,
            expectedVersion: 4,
            reason: 'policy_violation',
          }),
          expected: { v: 1, outcome: 'applied' },
        });
        await assertRejects({
          given: 'the audience while it is down',
          should: 'refuse the video',
          code: 'NOT_FOUND',
          actual: play,
        });
        assert({
          given: 'the restore',
          should: 'apply, with the feed staying ended',
          actual: [
            await moderate({
              action: 'recording.restore',
              recordingId: id,
              expectedVersion: 5,
            }),
            (
              (await sql`select stopped_at is not null as stopped from broadcasts where id=${broadcastId}`) as {
                stopped: boolean;
              }[]
            )[0]?.stopped,
          ],
          expected: [{ v: 1, outcome: 'applied' }, true],
        });
        assert({
          given: 'the audience after the restore',
          should: 'play the video again and list it in the archive',
          actual: [Boolean(await play()), await listed()],
          expected: [true, ['feed_ended']],
        });
        await moderate({
          action: 'broadcast.stop',
          broadcastId,
          reason: 'technical',
        });
        await assertRejects({
          given: 'an operator then stopping that Broadcast',
          should: 'hold the video back from the audience',
          code: 'NOT_FOUND',
          actual: play,
        });
        assert({
          given: 'the same stop, in the archive',
          should: 'no longer list the video to the public',
          actual: await listed(),
          expected: [],
        });
      } finally {
        await sql`delete from broadcasts where id=${broadcastId}`;
      }
    },
  );
});

test('a Recording of an abandoned Round can be found, and a participant can remove it', async () => {
  await withReadyRecording(
    async ({ store, inputs, id, roundId, seat, stranger }) => {
      const list = async (scope: 'all' | 'mine', viewerActorId: string) =>
        (
          await store.listArchive({
            query: { scope, mode: 'any', q: '', sort: 'newest', before: '' },
            viewerActorId,
            clock: spectatorClockAt(new Date().toISOString()),
            limit: 50,
          })
        ).rows.map((row) => row.id);
      const actorOf = (viewer: RecordingViewer) =>
        viewer.kind === 'account' ? viewer.actorId : '';
      assert({
        given: 'its participant looking through their own Rounds',
        should: 'find it',
        actual: (await list('mine', actorOf(seat))).includes(roundId),
        expected: true,
      });
      assert({
        given: 'a stranger looking through their own Rounds',
        should: 'not find it',
        actual: (await list('mine', actorOf(stranger))).includes(roundId),
        expected: false,
      });
      const removed = await requestParticipantRemoval(
        { store, inputs },
        { recordingId: id, expectedVersion: 4, viewer: seat, now: at },
      );
      assert({
        given: 'that participant asking to remove the casual Recording',
        should: 'write the removal',
        actual: removed.lifecycle.status,
        expected: 'removing',
      });
    },
    'abandoned',
  );
});

test('a participant removing a casual Recording ends the feed of its open Broadcast', async () => {
  await withReadyRecording(
    async ({ store, inputs, id, roundId, sql, seat, stranger }) => {
      const broadcastId = createId();
      await sql`insert into broadcasts (id, round_id, feed_key, release_policy)
        values (${broadcastId}, ${roundId}, ${createId()}, ${{ kind: 'delay', seconds: 60 }})`;
      const feed = async () => {
        const [row] =
          (await sql`select stop_reason, media_withheld from broadcasts
          where id=${broadcastId}`) as {
            stop_reason: string | null;
            media_withheld: boolean;
          }[];
        return [row?.stop_reason, row?.media_withheld];
      };
      const remove = (viewer: RecordingViewer, expectedVersion: number) =>
        requestParticipantRemoval(
          { store, inputs },
          { recordingId: id, expectedVersion, viewer, now: at },
        );
      try {
        await assertRejects({
          given: 'a stranger asking to remove it',
          should: 'refuse',
          code: 'AUTHORIZATION',
          actual: () => remove(stranger, 4),
        });
        await assertRejects({
          given: 'a participant whose form showed an old version',
          should: 'ask again',
          code: 'CONFLICT',
          actual: () => remove(seat, 3),
        });
        assert({
          given: 'those refusals',
          should: 'leave the feed playing',
          actual: await feed(),
          expected: [null, false],
        });
        const removed = await remove(seat, 4);
        assert({
          given: 'the participant confirming the current version',
          should: 'write the removal and end the feed under its own reason',
          actual: [removed.lifecycle.status, ...(await feed())],
          expected: ['removing', 'recording_removed_by_participant', false],
        });
      } finally {
        await sql`delete from broadcasts where id=${broadcastId}`;
      }
    },
  );
});

test('a Recording under an open report cannot be destroyed', async () => {
  await withReadyRecording(
    async ({ store, inputs, id, roundId, sql, seat, moderate }) => {
      const reportId = createId();
      await sql`insert into content_reports (id, target_kind, target_id, reason, queue)
        values (${reportId}, 'round', ${roundId}, 'harassment', 'safety')`;
      try {
        const asked = await requestParticipantRemoval(
          { store, inputs },
          { recordingId: id, expectedVersion: 4, viewer: seat, now: at },
        );
        assert({
          given:
            'a participant asking it to go while a report on its Round is open',
          should: 'hide it, with the removal owed and nothing deleted',
          actual: [
            asked.lifecycle.status,
            asked.lifecycle.status === 'taken_down' &&
              asked.lifecycle.removalOwed?.requestedAt,
          ],
          expected: ['taken_down', at],
        });
        await assertRejects({
          given: 'a moderation removal while the report is open',
          should: 'refuse',
          code: 'CONFLICT',
          actual: () =>
            moderate({
              action: 'recording.remove',
              recordingId: id,
              expectedVersion: 5,
            }),
        });
        assert({
          given: 'the hold, while the report is open',
          should: 'not be paid',
          actual: await store.listEndedEvidenceHolds({ now: at, limit: 100 }),
          expected: [],
        });
        await sql`update content_reports set status='dismissed', resolved_at=now(), resolved_by_ref='op' where id=${reportId}`;
        assert({
          given: 'the report closed',
          should: 'pay the removal it owed',
          actual: (
            await store.listEndedEvidenceHolds({ now: at, limit: 100 })
          ).includes(id),
          expected: true,
        });
      } finally {
        await sql`delete from content_reports where id=${reportId}`;
      }
    },
  );
});

test('an old failed casual Recording under an open report stays', async () => {
  await withReadyRecording(async ({ store, id, sql }) => {
    const reportId = createId();
    await sql`update recordings set status='failed',
        lifecycle=${JSON.stringify({ status: 'failed', reason: 'capture_failed', failedAt: at })}::text::jsonb,
        updated_at=${at}::timestamptz where id=${id}`;
    const due = () =>
      store.listFailedBefore({
        before: '2036-01-01T00:00:00.000Z',
        limit: 1000,
      });
    const before = (await due()).includes(id);
    await sql`insert into content_reports (id, target_kind, target_id, reason, queue)
      values (${reportId}, 'recording', ${id}, 'harassment', 'safety')`;
    try {
      assert({
        given: 'a failure past its retention, then a report on it',
        should: 'be due, then held back from cleanup',
        actual: [before, (await due()).includes(id)],
        expected: [true, false],
      });
    } finally {
      await sql`delete from content_reports where id=${reportId}`;
    }
  });
});

test('capture reports are idempotent against the real store', async () => {
  await withReadyRecording(async ({ store, id }) => {
    const record = await store.find(id);
    assert({
      given: 'the whole capture path',
      should: 'end ready at the version of its three moves',
      actual: [record?.lifecycle.status, record?.version],
      expected: ['ready', 4],
    });
  });
});

test('racing removals and a takedown settle to one state, and every link goes stale', async () => {
  await withReadyRecording(async ({ store, inputs, id, seat, moderate }) => {
    const objects = fakeObjectStore().store;
    const deps = { store, objects, inputs };
    const link = await openDownload(deps, {
      recordingId: id,
      viewer: seat,
      presentedLinkHashOf: () => null,
      nowMs,
    });
    assert({
      given: 'a subscriber before the takedown',
      should: 'get a link',
      actual: link.includes('expires=60'),
      expected: true,
    });
    const results = await Promise.allSettled([
      requestParticipantRemoval(
        { store, inputs },
        { recordingId: id, expectedVersion: 4, viewer: seat, now: at },
      ),
      moderate({
        action: 'recording.takedown',
        recordingId: id,
        expectedVersion: 4,
        reason: 'policy_violation',
      }),
    ]);
    assert({
      given: 'a removal racing a takedown on one version',
      should: 'let exactly one win',
      actual: results.filter((result) => result.status === 'fulfilled').length,
      expected: 1,
    });
    assert({
      given: 'the race',
      should: 'move the version exactly once',
      actual: (await store.find(id))?.version,
      expected: 5,
    });
    await assertRejects({
      given: 'a download after either outcome',
      should: 'refuse the new link',
      code: 'NOT_FOUND',
      actual: () =>
        openDownload(deps, {
          recordingId: id,
          viewer: seat,
          presentedLinkHashOf: () => null,
          nowMs,
        }),
    });
    await assertRejects({
      given: 'a player still fetching segments',
      should: 'refuse the next one',
      code: 'NOT_FOUND',
      actual: () =>
        openPlayback(deps, {
          recordingId: id,
          path: ['720p', 'seg.ts'],
          viewer: seat,
          presentedLinkHashOf: () => null,
          nowMs,
        }),
    });
  });
});

test('a takedown through the operator command leaves no new read, within the bound', async () => {
  await withReadyRecording(async ({ store, inputs, id, seat, moderate }) => {
    const signed: number[] = [];
    const fake = fakeObjectStore().store;
    const deps = {
      store,
      inputs,
      objects: {
        ...fake,
        signedRead: (key: string, options: { expiresInSeconds: number }) => {
          signed.push(options.expiresInSeconds);
          return fake.signedRead(key, options);
        },
      },
    };
    const viewer = {
      viewer: seat,
      presentedLinkHashOf: () => null,
      nowMs,
      recordingId: id,
    };
    await openPlayback(deps, { ...viewer, path: ['720p', 'seg.ts'] });
    await openDownload(deps, viewer);
    assert({
      given: 'the reads a viewer may already hold when the takedown lands',
      should: 'each last no longer than the delivery bound',
      actual: signed.every(
        (seconds) => seconds * 1000 <= CONTENT_MODERATION_DELIVERY_BOUND_MS,
      ),
      expected: true,
    });
    assert({
      given: 'a takedown naming the current version',
      should: 'apply',
      actual: await moderate({
        action: 'recording.takedown',
        recordingId: id,
        expectedVersion: 4,
        reason: 'policy_violation',
      }),
      expected: { v: 1, outcome: 'applied' },
    });
    await assertRejects({
      given: 'the very next segment request',
      should: 'refuse, with no waiting on any cache',
      code: 'NOT_FOUND',
      actual: () => openPlayback(deps, { ...viewer, path: ['720p', 'seg.ts'] }),
    });
    await assertRejects({
      given: 'a takedown naming the version it read before that',
      should: 'refuse and change nothing',
      code: 'CONFLICT',
      actual: () =>
        moderate({
          action: 'recording.takedown',
          recordingId: id,
          expectedVersion: 4,
          reason: 'policy_violation',
        }),
    });
    assert({
      given: 'the refused command',
      should: 'leave the version where the takedown put it',
      actual: (await store.find(id))?.version,
      expected: 5,
    });
  });
});

test('deletion survives a vendor outage and is idempotent to the end', async () => {
  await withReadyRecording(async ({ store, inputs, id, seat, keys }) => {
    await requestParticipantRemoval(
      { store, inputs },
      { recordingId: id, expectedVersion: 4, viewer: seat, now: at },
    );
    const later = nowMs + REMOVAL_SETTLE_MS + 1000;
    const down = fakeObjectStore(keys, { failRemoval: true });
    const failed = await runDeletionSweep({
      store,
      objects: down.store,
      owner: 'w1',
      nowMs: later,
      report: () => {},
    });
    assert({
      given: 'object storage down',
      should: 'keep the intent and delete nothing',
      actual: [
        failed.deferred >= 1,
        (await store.find(id))?.lifecycle.status,
        down.objects.size,
      ],
      expected: [true, 'removing', 2],
    });
    const up = fakeObjectStore(keys);
    // The retry comes due an hour on, as for a process that restarted.
    const retryAt = later + 3_600_000;
    await runDeletionSweep({
      store,
      objects: up.store,
      owner: 'w2',
      nowMs: retryAt,
      report: () => {},
    });
    assert({
      given: 'storage back',
      should: 'really delete the objects',
      actual: up.objects.size,
      expected: 0,
    });
    await runDeletionSweep({
      store,
      objects: up.store,
      owner: 'w3',
      nowMs: retryAt,
      report: () => {},
    });
    const removed = await store.find(id);
    assert({
      given: 'an empty prefix',
      should: 'end as removed, whole, with nothing left in the row',
      actual: [
        removed?.lifecycle.status,
        JSON.stringify(removed?.lifecycle).includes('speeches'),
      ],
      expected: ['removed', false],
    });
    const version = removed?.version;
    await runDeletionSweep({
      store,
      objects: up.store,
      owner: 'w4',
      nowMs: retryAt,
      report: () => {},
    });
    assert({
      given: 'the sweep run again',
      should: 'change nothing',
      actual: (await store.find(id))?.version,
      expected: version,
    });
  });
});

test('history reads the real Round and offers each panel on its own permission', async () => {
  await withReadyRecording(
    async ({ store, inputs, roundId, seat, stranger }) => {
      const round = (await inputs.readRound(roundId))!;
      const open = (viewer: RecordingViewer) =>
        openRecordingHistory(
          {
            readJobState: async () => null,
            nowMs: () => nowMs,
            readHistoryRound: async () => ({
              ...round,
              title: 'Round',
              resolution: 'x',
              ladder: null,
              sides: [],
              outcome: null,
              debaters: [],
            }),
            readBroadcastRelease: inputs.readBroadcastRelease,
            readTranscript: async () => null,
            readBallots: async () => [],
            holdsRecordingDownload: inputs.holdsRecordingDownload,
            readReuseFenced: inputs.readReuseFenced,
            findRecordingByRound: store.findByRound,
          },
          { roundId, viewer, presentedLinkHash: null, q: '' },
        );
      const seated = await open(seat);
      assert({
        given: 'a seat on the casual Recording',
        should: 'show playback, result, download and removal',
        actual: seated.kind === 'history' && [
          seated.media.state,
          seated.result?.headline,
          seated.downloadHref !== null,
          seated.removal !== null,
        ],
        expected: ['watch', 'No winner', true, true],
      });
      const other = await open(stranger);
      assert({
        given:
          'a stranger on an unlisted or public Recording, or a private one',
        should: 'never see removal or the result',
        actual:
          other.kind === 'unavailable' ||
          (other.removal === null && other.result === null),
        expected: true,
      });
    },
  );
});

test('the real signed takedown caller preserves stale refusal, atomic feed stop, replay and issuer readback', async () => {
  await withReadyRecording(async ({ database, id, roundId, sql }) => {
    await sql`insert into broadcasts(id,round_id,feed_key,release_policy) values(${createId()},${roundId},${createId()},${{ kind: 'delay', seconds: 60 }})`;
    const { handle } = api({
      store: database,
      contentModeration: database,
      nextId: createId,
    });
    const make = (expectedVersion: number) => ({
      v: 1,
      commandId: createId(),
      adminAuditHead: AUDIT_HEAD,
      expectedVersion,
      reason: 'policy_violation',
    });
    const put = (body: ReturnType<typeof make>) =>
      signed({
        method: 'PUT',
        path: `/operator/v1/recordings/${id}/takedown`,
        body: JSON.stringify(body),
      });
    const stale = await handle(put(make(99)));
    const [untouched] =
      await sql`select stopped_at is null as open from broadcasts where round_id=${roundId}`;
    const input = make(4);
    const applied = await handle(put(input));
    const result = await applied.json();
    const replay = await handle(put(input));
    const conflict = await handle(put({ ...input, expectedVersion: 5 }));
    const read = await handle(
      signed({
        method: 'GET',
        path: `/operator/v1/commands/${input.commandId}`,
      }),
    );
    const receipt = await read.json();
    const row = await database.findRecording(id);
    const [feed] =
      await sql`select stop_reason from broadcasts where round_id=${roundId}`;
    assert({
      given:
        'real signed stale/current/replayed/reused takedown commands and issuer readback',
      should:
        'preserve stale409 with live feed, commit Recording/feed/receipt together and replay the exact result',
      actual: [
        stale.status,
        untouched!.open,
        applied.status,
        result,
        replay.status,
        await replay.json(),
        conflict.status,
        read.status,
        receipt.action,
        receipt.result,
        row?.lifecycle.status,
        feed!.stop_reason,
      ],
      expected: [
        409,
        true,
        200,
        { v: 1, outcome: 'applied' },
        200,
        { v: 1, outcome: 'applied' },
        409,
        200,
        'recording.takedown',
        { v: 1, outcome: 'applied' },
        'taken_down',
        'policy_violation',
      ],
    });
  });
});

test('the signed takedown reports applied when a new feed ends even though the Recording is already down', async () => {
  await withReadyRecording(async ({ database, id, roundId, sql }) => {
    const { handle } = api({
      store: database,
      contentModeration: database,
      nextId: createId,
    });
    const put = (expectedVersion: number) =>
      handle(
        signed({
          method: 'PUT',
          path: `/operator/v1/recordings/${id}/takedown`,
          body: JSON.stringify({
            v: 1,
            commandId: createId(),
            adminAuditHead: AUDIT_HEAD,
            expectedVersion,
            reason: 'legal_request',
          }),
        }),
      );
    const first = await put(4);
    const down = await database.findRecording(id);
    await sql`insert into broadcasts(id,round_id,feed_key,release_policy) values(${createId()},${roundId},${createId()},${{ kind: 'delay', seconds: 60 }})`;
    const feedChanged = await put(down!.version);
    const unchanged = await put(down!.version);
    const after = await database.findRecording(id);
    assert({
      given:
        'an already-down Recording with a newly opened feed, then the same fresh-page request after the feed ended',
      should:
        'retain feed-applied precedence and then unchanged without advancing the Recording version',
      actual: [
        await first.json(),
        await feedChanged.json(),
        await unchanged.json(),
        after!.version === down!.version,
      ],
      expected: [
        { v: 1, outcome: 'applied' },
        { v: 1, outcome: 'applied' },
        { v: 1, outcome: 'unchanged' },
        true,
      ],
    });
  });
});

test('preparing takedown rollback restores Recording and feed on missing settlement, exceptions, receipt failure and deadline', async () => {
  await withReadyRecording(async ({ database, id, roundId, sql }) => {
    await sql`insert into broadcasts(id,round_id,feed_key,release_policy) values(${createId()},${roundId},${createId()},${{ kind: 'delay', seconds: 60 }})`;
    const outcomes = [];
    for (const mode of [
      'missing',
      'exception',
      'after-feed',
      'receipt-failure',
      'deadline',
    ] as const) {
      const input = {
        commandId: createId(),
        serviceId: 'daisy-admin',
        operatorRef: 'o'.repeat(24),
        requestDigest: 'd'.repeat(64),
        adminAuditHead: mode === 'receipt-failure' ? 'invalid' : AUDIT_HEAD,
        live: () => mode !== 'deadline',
        change: {
          action: 'recording.takedown' as const,
          recordingId: id,
          expectedVersion: 4,
          reason: 'legal_request' as const,
        },
      };
      const result = await database
        .recordingWithdrawalCommand(input, async (session) => {
          const loaded = await session.load();
          if (loaded.kind !== 'fresh' || loaded.recording === null)
            throw new Error('Expected preparing Recording');
          if (mode === 'missing') return;
          if (mode === 'exception')
            throw new Error('Controlled application failure');
          const feed = await loaded.endFeed(input.change.reason);
          if (mode === 'after-feed')
            throw new Error('Controlled post-feed failure');
          await loaded.settle({
            v: 1,
            outcome: feed === 'applied' ? 'applied' : loaded.recording,
          });
        })
        .then(
          () => 'committed',
          () => 'rejected',
        );
      const recording = await database.findRecording(id);
      const [effects] =
        await sql`select (select stopped_at is null from broadcasts where round_id=${roundId}) as open,(select count(*)::int from operator_command_receipts where command_id=${input.commandId}) as receipts`;
      outcomes.push([
        result,
        recording?.lifecycle.status,
        recording?.version,
        effects,
      ]);
    }
    assert({
      given:
        'preparing takedown followed by missing settlement, pre/post-feed exception, late receipt constraint failure or expired final liveness',
      should:
        'roll back Recording version/state, feed termination and receipt on every failure',
      actual: outcomes,
      expected: Array.from({ length: 5 }, () => [
        'rejected',
        'ready',
        4,
        { open: true, receipts: 0 },
      ]),
    });
    const escaped: {
      end?: () => Promise<unknown>;
      settle?: () => Promise<void>;
    } = {};
    const refused: string[] = [];
    const input = {
      commandId: createId(),
      serviceId: 'daisy-admin',
      operatorRef: 'o'.repeat(24),
      requestDigest: 'd'.repeat(64),
      adminAuditHead: AUDIT_HEAD,
      live: () => true,
      change: {
        action: 'recording.takedown' as const,
        recordingId: id,
        expectedVersion: 4,
        reason: 'legal_request' as const,
      },
    };
    const saved = await database.recordingWithdrawalCommand(
      input,
      async (session) => {
        const loaded = await session.load();
        if (loaded.kind !== 'fresh' || loaded.recording === null)
          throw new Error('Expected fresh');
        escaped.end = () => loaded.endFeed(input.change.reason);
        escaped.settle = () => loaded.settle({ v: 1, outcome: 'applied' });
        await loaded.endFeed(input.change.reason);
        await loaded.settle({ v: 1, outcome: 'applied' });
        for (const repeat of [
          () => session.load(),
          () => loaded.endFeed(input.change.reason),
          () => loaded.settle({ v: 1, outcome: 'applied' }),
        ])
          await repeat().catch((error: { code: string }) => {
            refused.push(error.code);
          });
      },
    );
    await escaped.end?.().catch((error: { code: string }) => {
      refused.push(error.code);
    });
    await escaped.settle?.().catch((error: { code: string }) => {
      refused.push(error.code);
    });
    let replayShape: unknown;
    const replay = await database.recordingWithdrawalCommand(
      { ...input, live: () => false },
      async (session) => {
        const loaded = await session.load();
        replayShape = [loaded.kind, 'endFeed' in loaded, 'settle' in loaded];
      },
    );
    assert({
      given:
        'completed takedown, repeated/escaped capabilities and same receipt with now-expired final liveness',
      should:
        'close all capabilities and expose no replay writer while preserving the exact receipt',
      actual: [saved, replay, replayShape, refused],
      expected: [
        { v: 1, outcome: 'applied' },
        { v: 1, outcome: 'applied' },
        ['replayed', false, false],
        Array.from({ length: 5 }, () => 'INVARIANT'),
      ],
    });
  });
});

test('signed removal callers roll back the shared Recording withdrawal transaction on late application failure', async () => {
  for (const operation of ['removal', 'legal-removal'] as const) {
    await withReadyRecording(async ({ database, id, roundId, sql }) => {
      await database.applyRecording(id, () => ({
        kind: 'moved',
        next: {
          status: 'taken_down',
          takenDownAt: at,
          reason: 'policy_violation',
          held: null,
        },
      }));
      await sql`insert into broadcasts(id,round_id,feed_key,release_policy) values(${createId()},${roundId},${createId()},${{ kind: 'delay', seconds: 60 }})`;
      const commandId = createId();
      const { handle } = api({
        store: database,
        contentModeration: {
          ...database,
          recordingWithdrawalCommand: (input, work) =>
            database.recordingWithdrawalCommand(input, async (session) => {
              await work(session);
              throw createAppError('CONFLICT');
            }),
        },
        nextId: createId,
      });
      const response = await handle(
        signed({
          method: 'PUT',
          path: `/operator/v1/recordings/${id}/${operation}`,
          body: JSON.stringify({
            v: 1,
            commandId,
            adminAuditHead: AUDIT_HEAD,
            expectedVersion: 5,
            ...(operation === 'legal-removal' ? { reason: 'court_order' } : {}),
          }),
        }),
      );
      const row = await database.findRecording(id);
      const [effects] =
        await sql`select (select stopped_at is null from broadcasts where round_id=${roundId}) as open,(select count(*)::int from operator_command_receipts where command_id=${commandId}) as receipts`;
      assert({
        given: `the actual signed ${operation} caller with a late application failure after feed and receipt work`,
        should:
          'refuse and restore Recording, Broadcast and receipt atomically',
        actual: [response.status, row?.lifecycle.status, row?.version, effects],
        expected: [409, 'taken_down', 5, { open: true, receipts: 0 }],
      });
    });
  }
});

test('actual signed removal and legal removal preserve stale refusal, feed reason, replay and issuer receipt', async () => {
  for (const operation of ['removal', 'legal-removal'] as const) {
    await withReadyRecording(async ({ database, id, roundId, sql }) => {
      await database.applyRecording(id, () => ({
        kind: 'moved',
        next: {
          status: 'taken_down',
          takenDownAt: at,
          reason: 'policy_violation',
          held: null,
        },
      }));
      await sql`insert into broadcasts(id,round_id,feed_key,release_policy) values(${createId()},${roundId},${createId()},${{ kind: 'delay', seconds: 60 }})`;
      const { handle } = api({
        store: database,
        contentModeration: database,
        nextId: createId,
      });
      const input = {
        v: 1,
        commandId: createId(),
        adminAuditHead: AUDIT_HEAD,
        expectedVersion: 5,
        ...(operation === 'legal-removal' ? { reason: 'court_order' } : {}),
      };
      const put = (body: typeof input) =>
        signed({
          method: 'PUT',
          path: `/operator/v1/recordings/${id}/${operation}`,
          body: JSON.stringify(body),
        });
      const stale = await handle(
        put({ ...input, commandId: createId(), expectedVersion: 99 }),
      );
      const [untouched] =
        await sql`select stopped_at is null as open from broadcasts where round_id=${roundId}`;
      const applied = await handle(put(input));
      const replay = await handle(put(input));
      const conflict = await handle(put({ ...input, expectedVersion: 6 }));
      const read = await handle(
        signed({
          method: 'GET',
          path: `/operator/v1/commands/${input.commandId}`,
        }),
      );
      const receipt = await read.json();
      const row = await database.findRecording(id);
      const [feed] =
        await sql`select stop_reason from broadcasts where round_id=${roundId}`;
      assert({
        given: `real signed stale/current/replayed/digest-conflicting ${operation} and issuer readback`,
        should:
          'preserve public outcomes, atomic Recording/feed withdrawal, exact receipt and action-specific cause',
        actual: [
          stale.status,
          untouched!.open,
          applied.status,
          await applied.json(),
          replay.status,
          await replay.json(),
          conflict.status,
          read.status,
          receipt.action,
          receipt.result,
          row?.lifecycle.status,
          row && 'cause' in row.lifecycle ? row.lifecycle.cause : null,
          feed!.stop_reason,
        ],
        expected: [
          409,
          true,
          200,
          { v: 1, outcome: 'applied' },
          200,
          { v: 1, outcome: 'applied' },
          409,
          200,
          operation === 'removal'
            ? 'recording.remove'
            : 'recording.legal_remove',
          { v: 1, outcome: 'applied' },
          'removing',
          operation === 'removal' ? 'moderation' : 'legal_removal',
          operation === 'removal'
            ? 'recording_removed'
            : 'recording_legally_removed',
        ],
      });
    });
  }
});
