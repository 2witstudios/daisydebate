import { instantMs } from '@daisy/clock';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { HydratedSegment, RoundProjection } from '@daisy/protocol/runtime';
import { createRoundRuntime } from './round-runtime';
import {
  emptyCheckpoint,
  oneOnOneRules,
  oneOnOneSeats,
  roundAt,
  runtimeWorld,
} from './runtime.test-support';

setupRitewayBun();

const pause = (at: number) => ({
  kind: 'pause' as const,
  atMs: instantMs(roundAt(at)),
  cause: 'vendor_unreachable' as const,
  confirmedUntilMs: instantMs(roundAt(15_000)),
});

/** Persist the public projection's segment writes, as a caller does. */
const persistedSegments = (
  before: readonly HydratedSegment[],
  projection: RoundProjection,
): readonly HydratedSegment[] =>
  [
    ...before,
    ...projection.segmentInserts.map((row) => ({
      ...row,
      endedAt: null,
      returnedMs: 0,
    })),
  ].map((row) => ({
    ...row,
    endedAt:
      projection.segmentCloses.find((close) => close.id === row.id)?.endedAt ??
      row.endedAt,
    returnedMs:
      projection.segmentReturns?.find((change) => change.id === row.id)
        ?.returnedMs ?? row.returnedMs,
  }));

describe('terminal Round runtime', () => {
  for (const ending of ['stop', 'forfeit', 'abandoned'] as const)
    for (const phase of ['paused', 'resuming'] as const)
      test(`${ending} while ${phase} persists hydratable terminal rows`, () => {
        const rules = oneOnOneRules();
        let world = runtimeWorld({ rules });
        const activated = world.activate({ at: roundAt(0), now: roundAt(0) });
        const opened = world.tick(roundAt(20_000));
        const segments = persistedSegments(
          persistedSegments([], activated),
          opened,
        );
        const paused = world.applyIncident(pause(20_000));
        if (paused.round === null)
          throw new Error('A pause projects its Round');
        world = createRoundRuntime({
          round: { id: 'round-1', ...paused.round },
          checkpoint: paused.round.checkpoint,
          segments,
          rules,
          participants: oneOnOneSeats,
          nextSegmentId: () => 'unused',
        });
        if (phase === 'resuming')
          world.applyIncident({
            kind: 'begin_resume',
            atMs: instantMs(roundAt(25_000)),
            countdownMs: 60_000,
          });
        const projection =
          ending === 'stop'
            ? world.stop(roundAt(30_000))
            : world.adjudicate({
                segmentId: segments[0]!.id,
                decision:
                  ending === 'forfeit'
                    ? {
                        evidence: 'settled_availability',
                        decision: 'forfeit',
                        winner: 'negative',
                        effectiveDeadlineMs: instantMs(roundAt(50_000)),
                        settledHorizonMs: instantMs(roundAt(55_000)),
                      }
                    : {
                        evidence: 'settled_availability',
                        decision: 'abandoned',
                        effectiveDeadlineMs: instantMs(roundAt(50_000)),
                        settledHorizonMs: instantMs(roundAt(55_000)),
                      },
                now: roundAt(55_000),
              });
        const { round } = projection;
        if (round === null)
          throw new Error('A terminal decision projects its Round');
        const restored = createRoundRuntime({
          round: { id: 'round-1', ...round },
          checkpoint: round.checkpoint,
          segments: persistedSegments(segments, projection),
          participants: oneOnOneSeats,
          rules,
          nextSegmentId: () => 'unused',
        });
        assert({
          given: `a live speech ${phase} by an incident, then ended by ${ending}`,
          should:
            'hydrate the persisted terminal state and close its incident once',
          actual: {
            status: restored.position(roundAt(90_000)).status,
            checkpoint: restored.checkpoint(),
            incidentChanges: projection.incidentChanges,
          },
          expected: {
            status: ending === 'forfeit' ? 'completed' : 'abandoned',
            checkpoint: {
              ...world.checkpoint(),
              incident: { phase: 'none' },
              clock_stops: [{ from: roundAt(20_000), to: round.completedAt }],
            },
            incidentChanges: [{ kind: 'ended', at: round.completedAt }],
          },
        });
      });

  for (const status of ['completed', 'abandoned'] as const)
    for (const phase of ['paused', 'resuming'] as const)
      test(`${status} absorbs every incident event from retained ${phase} state`, () => {
        // A retained terminal checkpoint without an open segment is valid when
        // the outage began outside a speech. It must remain historical data.
        const world = runtimeWorld({
          status,
          checkpoint: {
            ...emptyCheckpoint,
            incident:
              phase === 'paused'
                ? {
                    phase,
                    since: roundAt(0),
                    cause: 'vendor_unreachable',
                    resume_point: null,
                  }
                : {
                    phase,
                    since: roundAt(0),
                    until: roundAt(60_000),
                    cause: 'vendor_unreachable',
                    resume_point: null,
                  },
          },
        });
        const before = world.checkpoint();
        const events = [
          pause(90_000),
          {
            kind: 'begin_resume' as const,
            atMs: instantMs(roundAt(91_000)),
            countdownMs: 5_000,
          },
          { kind: 'end' as const, atMs: instantMs(roundAt(92_000)) },
        ];
        for (const event of events) {
          const projection = world.applyIncident(event);
          assert({
            given: `a ${status} Round with retained ${phase} incident receiving ${event.kind}`,
            should:
              'preserve the terminal checkpoint and emit no incident or segment changes',
            actual: {
              checkpoint: world.checkpoint(),
              status: projection.round?.status,
              incidents: projection.incidentChanges ?? [],
              closes: projection.segmentCloses,
              inserts: projection.segmentInserts,
              effects: projection.effects,
            },
            expected: {
              checkpoint: before,
              status,
              incidents: [],
              closes: [],
              inserts: [],
              effects: [],
            },
          });
        }
      });
});
