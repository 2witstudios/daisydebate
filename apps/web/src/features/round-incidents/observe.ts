import { isRoundRunning } from '@daisy/protocol';
import {
  createRoundRuntime,
  incidentDecision,
  observationMatters,
  type MediaObservation,
} from '@daisy/debate-engine';
import { createAppError } from '@daisy/errors';
import type { Database, RoundHydration } from '@daisy/db';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import { roundIncidentPolicy } from '@daisy/protocol';
import type { MediaPassReport } from '../round-media/operation-context';

type Store = Pick<
  Database['roundIncidents'],
  'observeRoundIncident' | 'readRoundIncidentWatch'
>;

const watchOf = (observation: MediaObservation) => ({
  unreachable: observation.kind === 'unreachable',
  roomRead: observation.kind === 'room',
});

/** The Round as it stands now, with any resume already due applied. */
const runtimeOf = (round: RoundHydration, nextId: () => string) =>
  createRoundRuntime({
    round,
    rules: round.rules,
    participants: round.participants,
    checkpoint: round.checkpoint,
    segments: round.segments,
    nextSegmentId: nextId,
  });

/**
 * The hook a recovery pass calls with what it saw. It never throws into the pass: a
 * failure here is reported and the next pass observes again, with a retirement still
 * waiting in `media_room_rotations`.
 */
export function createRoundIncidentObserver(input: {
  readonly store: Store;
  readonly reporter: ErrorReporter;
  readonly logger: Logger;
  readonly nextId: () => string;
}) {
  const observe = async (evidence: MediaPassReport) => {
    const { roundId, observation } = evidence;
    const outcome = await input.store.observeRoundIncident({
      roundId,
      watch: watchOf(observation),
      settle: (round, now) => runtimeOf(round, input.nextId).tick(now),
      decide: async ({
        round,
        now,
        roomRetired,
        unreachableSince,
        confirmedUntil,
      }) => {
        const nowMs = Date.parse(now);
        const decision = incidentDecision({
          incident: round.checkpoint.incident,
          nowMs,
          observation,
          roomRetired,
          unreachableSinceMs:
            unreachableSince === null ? null : Date.parse(unreachableSince),
          captureExpected: round.status === 'active',
        });
        if (decision === null) return null;
        const runtime = runtimeOf(round, input.nextId);
        switch (decision.kind) {
          case 'pause': {
            const confirmed = await confirmedUntil();
            return {
              projection: runtime.applyIncident({
                kind: 'pause',
                atMs: nowMs,
                cause: decision.cause,
                confirmedUntilMs:
                  confirmed === null ? null : Date.parse(confirmed),
              }),
            };
          }
          case 'begin_resume':
            return {
              projection: runtime.applyIncident({
                kind: 'begin_resume',
                atMs: nowMs,
                countdownMs: roundIncidentPolicy.resumeCountdownMs,
              }),
            };
          case 'end':
            return {
              projection: runtime.applyIncident({ kind: 'end', atMs: nowMs }),
            };
        }
      },
    });
    if (outcome.kind === 'opened') {
      input.logger.log(
        'round.incident.opened',
        { roundId },
        'A platform incident holds this Round',
      );
      // The operator alert, once per incident: only the insert that opened it reaches here.
      input.reporter.capture(
        createAppError('INFRASTRUCTURE', 'A platform incident holds a Round'),
        {
          requestId: input.nextId(),
          route: 'round.incident.opened',
          errorCode: 'INFRASTRUCTURE',
        },
      );
    }
    if (outcome.kind === 'ended')
      input.logger.log(
        'round.incident.ended',
        { roundId },
        'A platform incident ended this Round',
      );
  };
  return async (evidence: MediaPassReport): Promise<void> => {
    const { known, observation, nowMs } = evidence;
    if (!isRoundRunning(known.status)) return;
    try {
      const watch = await input.store.readRoundIncidentWatch(evidence.roundId);
      if (
        !observationMatters({
          incident: known.incident,
          nowMs,
          observation,
          roomRetired: watch.roomRetired,
          unreachableSinceMs:
            watch.unreachableSince === null
              ? null
              : Date.parse(watch.unreachableSince),
          captureExpected: known.status === 'active',
        })
      )
        return;
      await observe(evidence);
    } catch (error) {
      input.reporter.capture(error, {
        requestId: input.nextId(),
        route: 'round.incident.observe',
        errorCode: 'INFRASTRUCTURE',
      });
    }
  };
}
export type RoundIncidentObserver = ReturnType<
  typeof createRoundIncidentObserver
>;
