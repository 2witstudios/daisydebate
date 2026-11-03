import {
  createRoundRuntime,
  incidentDecision,
  observationMatters,
  type MediaObservation,
} from '@daisy/debate-engine';
import { createAppError } from '@daisy/errors';
import type { Database } from '@daisy/db';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import { roundIncidentPolicy, type RoundIncident } from '@daisy/protocol';

type Store = Pick<Database['roundIncidents'], 'observeRoundIncident'>;

/** What the recovery pass hands over: its own vendor evidence and nothing a browser said. */
export type RoundIncidentEvidence = {
  readonly roundId: string;
  readonly observation: MediaObservation;
  readonly roomRetired: boolean;
  /** Read from the pass's snapshot, so a healthy Round costs no Round lock. */
  readonly known: {
    readonly incident: RoundIncident;
    readonly status: string;
    readonly sawCapture: boolean;
    readonly unreachableSince: string | null;
  };
  readonly nowMs: number;
};

const watchOf = (observation: MediaObservation) => ({
  unreachable: observation.kind === 'unreachable',
  captureListed: observation.kind === 'room' ? observation.captureListed : null,
});

/**
 * The hook a recovery pass calls with what it saw. It never throws into the
 * pass: a failure here is reported, and the next pass observes again.
 */
export function createRoundIncidentObserver(input: {
  readonly store: Store;
  readonly reporter: ErrorReporter;
  readonly logger: Logger;
  readonly nextId: () => string;
}) {
  const observe = async (evidence: RoundIncidentEvidence) => {
    const { roundId, observation, roomRetired } = evidence;
    const outcome = await input.store.observeRoundIncident({
      roundId,
      watch: watchOf(observation),
      decide: async ({
        round,
        now,
        sawCapture,
        unreachableSince,
        confirmedUntil,
      }) => {
        const nowMs = Date.parse(now);
        const decision = incidentDecision({
          incident: round.checkpoint.incident,
          nowMs,
          observation,
          roomRetired,
          sawCapture,
          unreachableSinceMs:
            unreachableSince === null ? null : Date.parse(unreachableSince),
          captureExpected: round.status === 'active',
        });
        if (decision === null) return null;
        const runtime = createRoundRuntime({
          round,
          rules: round.rules,
          participants: round.participants,
          checkpoint: round.checkpoint,
          segments: round.segments,
          nextSegmentId: input.nextId,
        });
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
  return async (evidence: RoundIncidentEvidence): Promise<void> => {
    const { known, observation, roomRetired, nowMs } = evidence;
    if (known.status !== 'active' && known.status !== 'opening') return;
    if (
      !observationMatters({
        incident: known.incident,
        nowMs,
        observation,
        roomRetired,
        sawCapture: known.sawCapture,
        unreachableSinceMs:
          known.unreachableSince === null
            ? null
            : Date.parse(known.unreachableSince),
        captureExpected: known.status === 'active',
      })
    )
      return;
    try {
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
