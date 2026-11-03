import { spectatorClockAt } from '../src/features/spectating/spectator-clock';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import {
  oneOnOneDefinition,
  oneOnOneSettings,
} from '@daisy/db/reference-formats';
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
import {
  applyModeration,
  requestParticipantRemoval,
} from '../src/features/recording/removal';
import { launchRuntimeRound } from './round-runtime.test-support';
import { withRoomRuntime } from './room-runtime.test-support';

setupRitewayBun();
requireTestServices(process.env);

const at = '2026-11-02T10:00:00.000Z';
const nowMs = Date.parse(at);

/** A real launched Round with a real Recording, ready, through the capture port. */
const withReadyRecording = (
  run: (input: {
    store: ReturnType<typeof recordingPersistence>;
    inputs: RecordingInputs;
    id: string;
    roundId: string;
    sql: Parameters<Parameters<typeof withRoomRuntime>[0]>[0]['sql'];
    seat: RecordingViewer;
    stranger: RecordingViewer;
    keys: readonly string[];
  }) => Promise<void>,
) =>
  withRoomRuntime(async (f) => {
    const room = await f.assemble({
      selection: {
        kind: 'custom',
        definition: {
          ...oneOnOneDefinition,
          seats: { affirmative: 1, negative: 1, judge: 0 },
        },
        competitionType: 'casual',
        config: oneOnOneSettings,
      },
    });
    const { roundId } = await launchRuntimeRound(f, room);
    await f.sql`update rounds set status='completed', current_stage=null, started_at=${at}::timestamptz, completed_at=${at}::timestamptz where id=${roundId}`;
    const database = f.store as never as Parameters<
      typeof recordingPersistence
    >[0]['database'];
    const store = recordingPersistence({ database });
    const read = await database.readRecordingRound(roundId);
    const inputs: RecordingInputs = {
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
          }
        );
      },
      readBroadcastRelease: (roundId: string) =>
        database.readRecordingBroadcastRelease(
          roundId,
          spectatorClockAt(new Date().toISOString()),
        ),
      readFloorIntervals: database.readRecordingFloorIntervals,
      holdsRecordingDownload: async () => true,
    };
    const port = createRecordingCapturePort({
      store,
      inputs,
      nextId: createId,
    });
    const record = await port.request({
      roundId,
      competitionType: 'casual',
      hostActorId: read!.hostActorId,
      hostOptedIn: true,
      hostHoldsRecording: true,
    });
    const id = record!.id;
    const prefix = `recordings/${id}/`;
    await port.captureStarted(id, { egressId: 'EG', at });
    await port.captureEnded(id, {
      egressId: 'EG',
      sourceKey: `${prefix}source.mp4`,
      at,
    });
    await port.mediaVerified(id, {
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
        inputs,
        id,
        roundId,
        sql: f.sql,
        seat: { kind: 'account', userId: 'seat-user', actorId: seatActor },
        stranger: { kind: 'account', userId: 'other', actorId: createId() },
        keys: [`${prefix}hls/master.m3u8`, `${prefix}video.mp4`],
      });
    } finally {
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
              readHistoryRound: async () => ({
                ...round!,
                title: 'Round',
                resolution: 'x',
                outcome: null,
                debaters: [],
              }),
              readBroadcastRelease: inputs.readBroadcastRelease,
              readTranscript: async () => null,
              readBallots: async () => [],
              holdsRecordingDownload: inputs.holdsRecordingDownload,
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
        });
      const download = (link: string | null) =>
        openDownload(deps, {
          recordingId: id,
          viewer: stranger,
          presentedLinkHashOf: () => link,
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
  await withReadyRecording(async ({ store, inputs, id, seat }) => {
    const objects = fakeObjectStore().store;
    const deps = { store, objects, inputs };
    const link = await openDownload(deps, {
      recordingId: id,
      viewer: seat,
      presentedLinkHashOf: () => null,
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
      applyModeration(store, {
        recordingId: id,
        action: 'take_down',
        expectedVersion: 4,
        now: at,
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
        }),
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
            readHistoryRound: async () => ({
              ...round,
              title: 'Round',
              resolution: 'x',
              outcome: null,
              debaters: [],
            }),
            readBroadcastRelease: inputs.readBroadcastRelease,
            readTranscript: async () => null,
            readBallots: async () => [],
            holdsRecordingDownload: inputs.holdsRecordingDownload,
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
