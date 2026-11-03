import {
  phasePrivateAt,
  runningEgress,
  type StageEgressFact,
  type StagePhaseFact,
} from '@daisy/debate-engine';
import { holdAttemptPrefix, povHoldPrefix } from '@daisy/protocol';
import type { createDatabase } from '@daisy/db';
import type { PovEgress } from '@daisy/media/pov';
import { createSweepPass } from '../../lib/sweep-pass';
import {
  decidePovCapture,
  povSeatsOf,
  type PovCaptureAction,
} from './pov-capture-decision';

type Store = Pick<
  ReturnType<typeof createDatabase>['recordingPovs'],
  | 'listOpen'
  | 'readRound'
  | 'readSeats'
  | 'listPovs'
  | 'open'
  | 'claim'
  | 'hold'
  | 'recordStarted'
  | 'recordRevoked'
  | 'recordRevocationFailed'
  | 'recordRestored'
  | 'recordCameraHeight'
  | 'close'
>;
type Open = Awaited<ReturnType<Store['listOpen']>>[number];
type Row = Awaited<ReturnType<Store['listPovs']>>[number];
type Seat = Awaited<ReturnType<Store['readSeats']>>[number];

export type PovCaptureEvent =
  | 'recording.pov_capture_failed'
  | 'recording.pov.start_failed'
  | 'recording.pov.start_lost'
  | 'recording.pov.stop_failed'
  | 'recording.pov.restore_failed'
  | 'recording.pov.revoke_retry_failed';

const SEGMENT_SECONDS = 4;
const BATCH = 64;
const RECONCILE_LEASE_MS = 800;
/** Long enough for any start; a crash inside one delays the next by this much. */
const START_LEASE_MS = 15_000;
/** A refused start asks again after this: a full pool is not helped by every second. */
const START_RETRY_MS = 10_000;
const FULL_QUALITY_HEIGHT = 540;

const roundEnded = (status: string) =>
  status === 'completed' || status === 'abandoned';

const UNREADABLE = (id: string): StageEgressFact => ({
  kind: 'starting',
  id,
});

/**
 * One pass over every Recording capturing or with a POV to stop. Each debater runs
 * independently, so a failure on one POV reaches neither the other POV, the composite
 * nor the Round. The room is asked who is present only when an answer changes
 * something, and LiveKit is the one place a running Egress can be read from.
 */
export const createPovCaptureSweep = (deps: {
  readonly store: Store;
  /** The LiveKit holding this room: nothing here assumes there is only one. */
  readonly egressFor: (room: string) => PovEgress;
  readonly phaseAt: (
    round: NonNullable<Awaited<ReturnType<Store['readRound']>>>['round'],
    now: string,
  ) => StagePhaseFact;
  readonly now: () => number;
  readonly report: (event: PovCaptureEvent) => void;
  readonly passBudget?: () => Promise<void>;
}) => {
  const { store } = deps;
  const iso = (ms: number) => new Date(ms).toISOString();

  /** Unreadable counts as running: no second Egress, and privacy still applies. */
  const readEgress = (row: Row): Promise<StageEgressFact> =>
    row.egressId && row.egressRoom
      ? deps
          .egressFor(row.egressRoom)
          .read(row.egressId)
          .catch(() => UNREADABLE(row.egressId!))
      : Promise.resolve({ kind: 'none' });

  const attempt = async (
    work: () => Promise<unknown>,
    failed: () => Promise<unknown> | void,
  ) => {
    try {
      await work();
    } catch {
      await failed();
    }
  };

  const start = (row: Row, room: string, identity: string, nowMs: number) => {
    const pov = {
      recordingId: row.recordingId,
      roundParticipantId: row.roundParticipantId,
    };
    const generation = row.egressGeneration + 1;
    const egress = deps.egressFor(room);
    let retryAt: Date | null = null;
    return attempt(
      async () => {
        // The claim outlasts the call, so no other instance starts another.
        await store.hold({ ...pov, until: new Date(nowMs + START_LEASE_MS) });
        const egressId = await egress.start({
          room,
          identity,
          holdPrefix: holdAttemptPrefix(
            povHoldPrefix(row.recordingId, row.roundParticipantId),
            generation,
          ),
          segmentSeconds: SEGMENT_SECONDS,
        });
        const won = await store.recordStarted({
          ...pov,
          egressId,
          room,
          generation,
          now: new Date(nowMs),
        });
        if (won) return;
        deps.report('recording.pov.start_lost');
        await egress.stop(egressId);
      },
      () => {
        retryAt = new Date(nowMs + START_RETRY_MS);
        deps.report('recording.pov.start_failed');
      },
    ).finally(() => store.hold({ ...pov, until: retryAt }));
  };

  const run = (
    row: Row,
    action: PovCaptureAction,
    target: { readonly room: string | null; readonly identity: string | null },
    nowMs: number,
  ) => {
    const pov = {
      recordingId: row.recordingId,
      roundParticipantId: row.roundParticipantId,
    };
    const { egressId, egressRoom } = row;
    const inRoom = (
      work: (egress: PovEgress, id: string) => Promise<unknown>,
    ) =>
      egressId && egressRoom
        ? work(deps.egressFor(egressRoom), egressId)
        : Promise.resolve();
    switch (action.type) {
      case 'start-pov':
        return target.room && target.identity
          ? start(row, target.room, target.identity, nowMs)
          : undefined;
      case 'stop-pov':
        return attempt(
          () => inRoom((egress) => egress.stop(action.id)),
          () => deps.report('recording.pov.stop_failed'),
        );
      case 'close-pov':
        return store.close({ ...pov, now: new Date(nowMs) });
      case 'revoke-observer':
        return attempt(
          async () => {
            await inRoom((egress, id) => egress.revoke(egressRoom!, id));
            await store.recordRevoked({ ...pov, now: new Date(nowMs) });
          },
          () => store.recordRevocationFailed(pov),
        );
      case 'reassert-revocation':
        return attempt(
          () => inRoom((egress, id) => egress.revoke(egressRoom!, id)),
          () => deps.report('recording.pov.revoke_retry_failed'),
        );
      case 'restore-observer':
        return attempt(
          async () => {
            await inRoom((egress, id) => egress.restore(egressRoom!, id));
            await store.recordRestored(pov);
          },
          () => deps.report('recording.pov.restore_failed'),
        );
    }
  };

  const reconcilePov = async (
    open: Open,
    row: Row,
    context: {
      readonly nowMs: number;
      readonly roundEnded: boolean;
      readonly phase: StagePhaseFact;
      readonly room: string | null;
      readonly identity: string | null;
      readonly present: () => Promise<
        readonly {
          readonly identity: string;
          readonly cameraHeight: number | null;
        }[]
      >;
    },
  ) => {
    const { nowMs, phase, room, identity } = context;
    const pov = {
      recordingId: row.recordingId,
      roundParticipantId: row.roundParticipantId,
    };
    if (
      !(await store.claim({
        ...pov,
        now: new Date(nowMs),
        until: new Date(nowMs + RECONCILE_LEASE_MS),
      }))
    )
      return;
    const egress = await readEgress(row);
    const capturing =
      open.lifecycle.status === 'capturing' && !context.roundEnded;
    const looking =
      capturing && row.camera && (row.cameraHeight ?? 0) < FULL_QUALITY_HEIGHT;
    const startable =
      capturing && !runningEgress(egress) && !phasePrivateAt(phase, nowMs);
    const here =
      (looking || startable) && identity !== null
        ? (await context.present()).find((p) => p.identity === identity)
        : undefined;
    if (looking && here?.cameraHeight)
      await store.recordCameraHeight({ ...pov, height: here.cameraHeight });
    const actions = decidePovCapture({
      nowMs,
      lifecycle: open.lifecycle,
      roundEnded: context.roundEnded,
      phase,
      egressId: row.egressId,
      egress,
      startedAtMs: row.egressStartedAt?.getTime() ?? null,
      observerSubscribed: row.observerRevokedAt === null,
      revocationFailures: row.revocationFailures,
      present: here !== undefined,
    });
    for (const action of actions)
      await run(row, action, { room, identity }, nowMs);
  };

  const openSeats = async (open: Open, seats: readonly Seat[]) => {
    for (const seat of povSeatsOf(seats))
      await store.open({
        recordingId: open.id,
        roundId: open.roundId,
        roundParticipantId: seat.roundParticipantId,
        camera: seat.camera,
      });
  };

  const reconcile = async (open: Open) => {
    const nowMs = deps.now();
    const ended = roundEnded(open.roundStatus);
    const capturing = open.lifecycle.status === 'capturing' && !ended;
    const seats = capturing ? await store.readSeats(open.roundId) : [];
    if (capturing) await openSeats(open, seats);
    const read = capturing ? await store.readRound(open.roundId) : null;
    const phase: StagePhaseFact = read
      ? deps.phaseAt(read.round, iso(nowMs))
      : { kind: 'private' };
    const room = read?.roomName ?? null;
    let listed: ReturnType<PovEgress['participants']> | null = null;
    const present = () =>
      room === null
        ? Promise.resolve([])
        : (listed ??= deps.egressFor(room).participants(room));
    const rows = await store.listPovs(open.id);
    await Promise.all(
      rows
        .filter((row) => row.endedAt === null)
        .map((row) =>
          reconcilePov(open, row, {
            nowMs,
            roundEnded: ended,
            phase,
            room,
            identity:
              seats.find(
                (seat) => seat.roundParticipantId === row.roundParticipantId,
              )?.identity ?? null,
            present,
          }).catch(() => deps.report('recording.pov_capture_failed')),
        ),
    );
  };

  const pass = createSweepPass(deps.passBudget);
  const failed = () => deps.report('recording.pov_capture_failed');
  const sweep = () =>
    pass.overPages(
      BATCH,
      (after) => store.listOpen(BATCH, after),
      (open) => open.id,
      reconcile,
      failed,
    );
  return Object.assign(sweep, { settled: pass.settled });
};
