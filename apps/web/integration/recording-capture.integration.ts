import { spectatorClockAt } from '../src/features/spectating/spectator-clock';
import { requireTestServices } from '@daisy/config';
import { createRecordingWorkerStore } from '@daisy/db/recording-worker';
import { broadcastPhase, createRoundRuntime } from '@daisy/debate-engine';
import {
  oneOnOneDefinition,
  oneOnOneSettings,
} from '@daisy/db/reference-formats';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRecordingCapturePort } from '../src/features/recording/capture-port';
import { createRecordingCaptureSweep } from '../src/features/recording/capture-sweep';
import { recordingPersistence } from '../src/features/recording/persistence';
import { launchRuntimeRound } from './round-runtime.test-support';
import { withRoomRuntime } from './room-runtime.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const T0 = Date.parse('2036-01-01T10:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

type Harness = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];

const setup = async (f: Harness, capture: { readonly broadcast: boolean }) => {
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
  await f.sql`update rounds set capture=${JSON.stringify({
    recording: true,
    broadcast: capture.broadcast
      ? { release: { kind: 'delay', seconds: 60 }, debatersReadChat: false }
      : null,
  })}::text::jsonb where id=${roundId}`;
  const database = f.store as never as Parameters<
    typeof recordingPersistence
  >[0]['database'];
  const store = recordingPersistence({ database });
  const port = createRecordingCapturePort({
    store,
    nextId: createId,
    inputs: {
      readFloorIntervals: database.readRecordingFloorIntervals,
      readCoverageFacts: database.readRecordingCoverageFacts,
      readBroadcastRelease: (roundId) =>
        database.readRecordingBroadcastRelease(
          roundId,
          spectatorClockAt(new Date().toISOString()),
        ),
    },
  });
  let nowMs = T0;
  let started = 0;
  const events: string[] = [];
  const egressState = new Map<string, unknown>();
  const sweep = createRecordingCaptureSweep({
    store: (database as never as { recordingCaptures: never })
      .recordingCaptures,
    port,
    egress: {
      start: async ({ holdPrefix }) => {
        started += 1;
        const id = `EG_${started}`;
        events.push(`start ${holdPrefix}`);
        egressState.set(id, { kind: 'active', id });
        return id;
      },
      stop: async (id) => {
        events.push(`stop ${id}`);
        egressState.set(id, { kind: 'complete' });
      },
      read: async (id) =>
        (egressState.get(id) ?? { kind: 'failed', id }) as never,
      revokeObserver: async () => {
        events.push('revoke');
      },
      restoreObserver: async () => {
        events.push('restore');
      },
    },
    holdsCapture: () => true,
    phaseAt: (round, now) =>
      broadcastPhase(
        createRoundRuntime({
          ...round,
          round,
          nextSegmentId: createId,
        } as never).position(now),
        round.rules.segments.length - 1,
      ),
    now: () => nowMs,
    newCredential: () => ({ secret: 's', hash: 'digest' }),
    stageUrl: (id, credential) =>
      `https://app.test/stage/${id}?c=${credential}`,
    report: (event) => events.push(`report ${event}`),
  });
  return {
    roundId,
    store,
    sweep,
    events,
    egressState,
    advance: (ms: number) => {
      nowMs += ms;
    },
    now: () => nowMs,
    worker: createRecordingWorkerStore(databaseUrl),
  };
};

const lifecycleOf = async (
  store: ReturnType<typeof recordingPersistence>,
  roundId: string,
) => (await store.findByRound(roundId))?.lifecycle;

test('a Broadcast with a crash becomes one Recording spanning both attempts', async () => {
  await withRoomRuntime(async (f) => {
    const h = await setup(f, { broadcast: true });
    try {
      const { roundId } = h;
      const broadcastId = createId();
      await f.sql`insert into broadcasts (feed_key, id, round_id, release_policy, egress_id, egress_generation, egress_started_at)
        values (${createId()}, ${broadcastId}, ${roundId}, ${JSON.stringify({ kind: 'delay', seconds: 60 })}::text::jsonb, 'EG_A', 1, ${iso(T0)}::timestamptz)`;
      await h.sweep();
      await h.sweep();
      const first = await lifecycleOf(h.store, roundId);
      assert({
        given: 'a running Broadcast Egress',
        should: 'capture from its hold, starting nothing itself',
        actual: [
          first?.status,
          first?.status === 'capturing' ? first.capture.source : null,
          h.events,
        ],
        expected: ['capturing', { kind: 'broadcast_hold', broadcastId }, []],
      });

      h.advance(30_000);
      await f.sql`update broadcasts set egress_id='EG_B', egress_generation=2, egress_started_at=${iso(h.now())}::timestamptz where id=${broadcastId}`;
      await h.sweep();
      const restarted = await lifecycleOf(h.store, roundId);
      assert({
        given: 'a crash that started attempt 2',
        should: 'span both attempts in order',
        actual:
          restarted?.status === 'capturing'
            ? restarted.capture.attempts.map((a) => [a.attempt, a.egressId])
            : restarted?.status,
        expected: [
          [1, 'EG_A'],
          [2, 'EG_B'],
        ],
      });

      h.advance(30_000);
      h.egressState.set('EG_B', { kind: 'active', id: 'EG_B' });
      await f.sql`update rounds set status='completed', current_stage=null, completed_at=${iso(h.now())}::timestamptz where id=${roundId}`;
      await h.sweep();
      assert({
        given: 'the Round over with Egress still uploading',
        should: 'keep capturing, so nothing is read half written',
        actual: (await lifecycleOf(h.store, roundId))?.status,
        expected: 'capturing',
      });
      h.egressState.set('EG_B', { kind: 'complete' });
      await h.sweep();
      await h.sweep();
      assert({
        given: 'the Egress complete',
        should: 'move to processing',
        actual: (await lifecycleOf(h.store, roundId))?.status,
        expected: 'processing',
      });

      const record = await h.store.findByRound(roundId);
      const claimed = await h.worker.claim({
        owner: 'w',
        now: new Date(Date.now() + 86_400_000),
        leaseUntil: new Date(Date.now() + 2 * 86_400_000),
      });
      assert({
        given: 'the worker asking for work',
        should: 'read both attempts from the Broadcast hold',
        actual: [claimed?.recordingId, claimed?.holdPrefix, claimed?.state],
        expected: [
          record?.id,
          `hold/${broadcastId}/`,
          // A 60 s capture: its bound is 5.5 minutes, so one run may take 16.5.
          {
            status: 'queued',
            attemptCount: 2,
            ceilingMs: 990_000,
            controlLapses: [],
          },
        ],
      });

      const prefix = `recordings/${record?.id}/`;
      await h.worker.finish({
        recordingId: record?.id ?? '',
        owner: 'w',
        epoch: claimed?.leaseEpoch ?? 0,
        expected: 'queued',
        state: {
          status: 'built',
          media: {
            capturedFrom: iso(T0),
            playlistKey: `${prefix}hls/master.m3u8`,
            downloadKey: `${prefix}video.mp4`,
            durationMs: 60_000,
            byteSize: 100,
            verifiedAt: iso(h.now()),
            gaps: [
              { startMs: 25_000, endMs: 30_000, reason: 'capture_restart' },
            ],
          },
        },
      });
      await h.sweep();
      const ready = await lifecycleOf(h.store, roundId);
      assert({
        given: 'the worker report',
        should: 'be ready through the port, gaps intact',
        actual:
          ready?.status === 'ready'
            ? [ready.status, ready.media.gaps.length, ready.media.durationMs]
            : ready?.status,
        expected: ['ready', 1, 60_000],
      });
      await h.sweep();
      assert({
        given: 'a ready Recording whose Broadcast still holds its sources',
        should: 'wait, with its sources still owed',
        actual: await h.store.sourcesRemain(record?.id ?? ''),
        expected: true,
      });
      const [job] =
        await f.sql`select status from recording_processing_jobs where recording_id=${record?.id ?? ''}`;
      await f.sql`update broadcasts set completed_at=${iso(h.now())}::timestamptz where id=${broadcastId}`;
      await h.sweep();
      const [after] =
        await f.sql`select status from recording_processing_jobs where recording_id=${record?.id ?? ''}`;
      assert({
        given: 'the Broadcast finished',
        should: 'ask the worker to clear the sources',
        actual: [job.status, after.status],
        expected: ['built', 'discarding'],
      });
    } finally {
      await h.worker.close();
      await f.sql`delete from recording_processing_jobs where recording_id in (select id from recordings where round_id=${h.roundId})`;
      await f.sql`delete from recording_captures where round_id=${h.roundId}`;
      await f.sql`delete from recordings where round_id=${h.roundId}`;
      await f.sql`delete from broadcasts where round_id=${h.roundId}`;
    }
  });
});

test('a casual Recording with no Broadcast runs and stops its own Egress', async () => {
  await withRoomRuntime(async (f) => {
    const h = await setup(f, { broadcast: false });
    try {
      const { roundId } = h;
      await f.sql`insert into recordings (id, round_id, recording_class, eligibility, status, lifecycle)
        values (${createId()}, ${roundId}, 'casual', ${JSON.stringify({ kind: 'host_opt_in', hostActorId: 'a'.repeat(24) })}::text::jsonb, 'requested', ${JSON.stringify({ status: 'requested' })}::text::jsonb)`;
      // A Round not yet at a public phase records the revocation before any start,
      // so the Egress's first token carries no subscribe permission.
      const pass = async () => {
        h.advance(1000);
        await h.sweep();
      };
      await h.sweep();
      await pass();
      await pass();
      const record = await h.store.findByRound(roundId);
      const capturing = await lifecycleOf(h.store, roundId);
      assert({
        given: 'a Round with no Broadcast',
        should: 'start one Egress under its own hold and report it',
        actual: [
          h.events.filter((event) => event.startsWith('start')),
          capturing?.status,
          capturing?.status === 'capturing' ? capturing.capture.source : null,
        ],
        expected: [
          [`start recording-hold/${record?.id}/1/`],
          'capturing',
          { kind: 'own_capture' },
        ],
      });
      await pass();
      assert({
        given: 'that Egress running',
        should: 'start no second one',
        actual: h.events.filter((event) => event.startsWith('start')).length,
        expected: 1,
      });
      h.egressState.set('EG_1', { kind: 'failed', id: 'EG_1' });
      await pass();
      await pass();
      const restarted = await lifecycleOf(h.store, roundId);
      assert({
        given: 'that Egress crashed',
        should: 'start the next attempt under its own number and span both',
        actual: [
          h.events.filter((event) => event.startsWith('start')).at(-1),
          restarted?.status === 'capturing'
            ? restarted.capture.attempts.map((a) => a.attempt)
            : restarted?.status,
        ],
        expected: [`start recording-hold/${record?.id}/2/`, [1, 2]],
      });
      await f.sql`update rounds set status='completed', current_stage=null, completed_at=${iso(h.now())}::timestamptz where id=${roundId}`;
      await pass();
      assert({
        given: 'the Round over',
        should: 'stop the Egress',
        actual: h.events.at(-1),
        expected: 'stop EG_2',
      });
      await pass();
      await pass();
      const [capture] =
        await f.sql`select ended_at from recording_captures where recording_id=${record?.id ?? ''}`;
      const [job] =
        await f.sql`select status, state from recording_processing_jobs where recording_id=${record?.id ?? ''}`;
      assert({
        given: 'the Egress gone',
        should: 'close the capture and queue every attempt',
        actual: [
          (await lifecycleOf(h.store, roundId))?.status,
          capture.ended_at !== null,
          job.status,
          job.state.attemptCount,
        ],
        expected: ['processing', true, 'queued', 2],
      });
      const stage = await (
        f.store as never as {
          recordingCaptures: {
            readStage: (id: string) => Promise<{
              capture: { completedAt: Date | null };
              seats: readonly unknown[];
            } | null>;
          };
        }
      ).recordingCaptures.readStage(record?.id ?? '');
      assert({
        given: 'the stage page asking after the capture closed',
        should: 'see it closed, which the stage route refuses',
        actual: stage?.capture.completedAt instanceof Date,
        expected: true,
      });
    } finally {
      await h.worker.close();
      await f.sql`delete from recording_processing_jobs where recording_id in (select id from recordings where round_id=${h.roundId})`;
      await f.sql`delete from recording_captures where round_id=${h.roundId}`;
      await f.sql`delete from recordings where round_id=${h.roundId}`;
      await f.sql`delete from broadcasts where round_id=${h.roundId}`;
    }
  });
});
