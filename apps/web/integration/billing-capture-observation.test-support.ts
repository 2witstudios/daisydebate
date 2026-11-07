import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { broadcastPhase, createRoundRuntime } from '@daisy/debate-engine';
import {
  oneOnOneDefinition,
  oneOnOneSettings,
} from '@daisy/db/reference-formats';
import { hostHoldsCasualCapture } from '../src/features/room-runtime/capture-offer';
import { createRecordingCaptureSweep } from '../src/features/recording/capture-sweep';
import { createRecordingCapturePort } from '../src/features/recording/capture-port';
import { newStageCredential } from '../src/features/stage-capture/stage-access';
import { spectatorClockAt } from '../src/features/spectating/spectator-clock';
import { recordingPersistence } from '../src/features/recording/persistence';
import { everyoneReady } from './round-judging.test-support';
import { launchRuntimeRound } from './round-runtime.test-support';
import type { withRoomRuntime } from './room-runtime.test-support';

type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
type Interval = { began: number; ended: number | null };
type Attempt = {
  readonly prefix: string;
  readonly at: number;
  readonly interval: Interval;
  kind: 'active' | 'complete';
};
const childEntry = new URL(
  '../../recording-worker/integration/billing-capture-build.test-support.ts',
  import.meta.url,
).pathname;
async function captureChild(input: Readonly<Record<string, unknown>>) {
  const child = Bun.spawn(['bun', childEntry], {
    cwd: process.cwd(),
    env: process.env,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  child.stdin.write(JSON.stringify(input));
  child.stdin.end();
  const [output, error, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw Error(`Controlled capture child failed: ${error.slice(0, 1500)}`);
  return JSON.parse(output) as {
    action: string;
    role?: string;
    sourceBytes?: number;
    output?: { status: string; durationMs: number; byteSize: number };
  };
}
export function captureWebPool(url: string) {
  const pool = new SQL(url, { max: 6 }),
    reserve = pool.reserve.bind(pool),
    roles = new Set<string>();
  pool.reserve = async (options) => {
    const connection = await reserve(options);
    await connection`set role daisy_web`;
    roles.add((await connection`select current_user as role`)[0]!.role);
    return connection;
  };
  return { pool, roles };
}
export async function prepareCaptureRoom(
  f: Fixture,
  cast = { host: f.host, guest: f.guest },
) {
  const view = await f.assemble(
    {
      selection: {
        kind: 'custom',
        definition: {
          ...oneOnOneDefinition,
          seats: { affirmative: 1, negative: 1, judge: 0 },
        },
        competitionType: 'casual',
        config: {
          ...oneOnOneSettings,
          speechTiming: { ...oneOnOneSettings.speechTiming, countdownMs: 0 },
        },
      },
    },
    cast,
  );
  const chosen = (
    await f.command(cast.host, view, {
      type: 'set-capture',
      capture: { recording: true, broadcast: null },
    })
  ).view;
  return everyoneReady(f, chosen, [cast.host, cast.guest]);
}
export function captureHarness(f: Fixture, root: string) {
  const database = f.store,
    store = recordingPersistence({ database });
  const roundIds: string[] = [];
  const intervals: Interval[] = [],
    sources: number[] = [],
    failures: string[] = [],
    attempts = new Map<string, Attempt>();
  const port = createRecordingCapturePort({
    store,
    nextId: createId,
    inputs: {
      readFloorIntervals: database.readRecordingFloorIntervals,
      readCoverageFacts: database.readRecordingCoverageFacts,
      readBroadcastRelease: (id) =>
        database.readRecordingBroadcastRelease(
          id,
          spectatorClockAt(new Date().toISOString()),
        ),
    },
  });
  const sweep = createRecordingCaptureSweep({
    store: database.recordingCaptures,
    port,
    egress: {
      start: async ({ holdPrefix }) => {
        const id = `EG_${createId()}`,
          interval = { began: performance.now(), ended: null };
        intervals.push(interval);
        attempts.set(id, {
          prefix: holdPrefix,
          at: Date.now(),
          interval,
          kind: 'active',
        });
        return id;
      },
      stop: async (id) => {
        const attempt = attempts.get(id);
        if (!attempt || attempt.kind === 'complete') return;
        const result = await captureChild({
          action: 'source',
          root,
          prefix: attempt.prefix,
          at: attempt.at,
          durationMs: Date.now() - attempt.at,
        });
        attempt.interval.ended = performance.now();
        sources.push(result.sourceBytes!);
        attempt.kind = 'complete';
      },
      read: async (id) => {
        const a = attempts.get(id);
        return a?.kind === 'active'
          ? { kind: 'active', id }
          : a
            ? { kind: 'complete' }
            : { kind: 'failed', id };
      },
      revokeObserver: async () => {},
      restoreObserver: async () => {},
    },
    holdsCapture: (grants) =>
      hostHoldsCasualCapture(grants, true, new Date().toISOString()),
    phaseAt: (round, now) =>
      broadcastPhase(
        createRoundRuntime({
          ...round,
          round,
          nextSegmentId: createId,
        }).position(now),
        round.rules.segments.length - 1,
      ),
    now: Date.now,
    newCredential: newStageCredential,
    stageUrl: (id, secret) => `https://local.invalid/stage/${id}?c=${secret}`,
    report: (event) => failures.push(event),
  });
  const until = async (ready: () => Promise<boolean>) => {
    for (let i = 0; i < 12; i++) {
      await sweep();
      if (failures.length)
        throw Error(`Capture sweep failed: ${failures.join(',')}`);
      if (await ready()) return;
      await Bun.sleep(1_000); // The production capture sweep's ordinary one-second cadence.
    }
    throw Error('Named capture lifecycle did not reach its bounded milestone');
  };
  return {
    store,
    roundIds,
    intervals,
    sources,
    failures,
    sweep,
    until,
    start: async (room: Parameters<typeof launchRuntimeRound>[1]) => {
      const round = await launchRuntimeRound(f, room);
      roundIds.push(round.roundId);
      await round.operations.tick(round.roundId);
      await until(
        async () =>
          (await store.findByRound(round.roundId))?.lifecycle.status ===
          'capturing',
      );
      return round;
    },
    end: async (round: Awaited<ReturnType<typeof launchRuntimeRound>>) => {
      const live = (await f.store.getRound(round.roundId))!,
        seat = live.participants.find(
          (p) => p.actorId === round.principal.actorId,
        )!;
      await round.operations.command(round.principal, round.roundId, {
        version: 1,
        commandId: createId(),
        expectedVersion: live.version,
        command: { type: 'forfeit', participantId: seat.id },
      });
      await until(
        async () =>
          (await store.findByRound(round.roundId))?.lifecycle.status ===
          'processing',
      );
      await until(
        async () =>
          (
            await database.recordingCaptures.readJobState(
              (await store.findByRound(round.roundId))!.id,
            )
          )?.status === 'queued',
      );
      const record = (await store.findByRound(round.roundId))!;
      const processed = await captureChild({
        action: 'build',
        root,
        recordingId: record.id,
        owner: createId(),
      });
      await until(
        async () => (await store.find(record.id))?.lifecycle.status === 'ready',
      );
      return { record, processed };
    },
    settled: sweep.settled,
  };
}
