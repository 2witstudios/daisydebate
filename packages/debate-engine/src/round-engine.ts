import type { RoundRules } from '@daisy/protocol/format';
import type { RoundCommand } from '@daisy/protocol/runtime';
import type { RoundPanelCompletion } from '@daisy/protocol/round-panel-completion';
import { advanceRoundClock } from './round-clock';
import { abandonedLifecycle } from './round-clock-state';
import {
  applyRoundCommand,
  closePlayedRound,
  startRound,
  type StepFacts,
} from './round-commands';
import {
  applyRoundAdjudication,
  type RoundAdjudicationEvent,
} from './round-adjudication';
import { applyPanelCompletion } from './round-panel-completion';
import { incidentTransition, type IncidentEvent } from './round-incident';
import { startGateTransition, type StartGateEvent } from './round-start-gate';
import {
  clockOf,
  settleFinalEnd,
  stepFrom,
  take,
  withCheckpoint,
  withLifecycle,
  type RoundState,
  type RoundStep,
} from './round-step';

/** Everything that can happen to a Round, each at its own instant. */
export type RoundEvent =
  /** A participant's command; legality decides whether it stands. */
  | {
      readonly kind: 'command';
      readonly command: RoundCommand;
      readonly actorId: string | null;
      readonly atMs: number;
    }
  /** Time alone. */
  | { readonly kind: 'tick'; readonly atMs: number }
  /** The opening ended at `startedAtMs`; the clock catches up to `atMs`. */
  | {
      readonly kind: 'activate';
      readonly startedAtMs: number;
      readonly atMs: number;
    }
  /** The owner stops a live Round. */
  | { readonly kind: 'stop'; readonly atMs: number }
  /** The durable attendance evaluator's verified decision. */
  | {
      readonly kind: 'adjudicate';
      readonly adjudication: RoundAdjudicationEvent;
      readonly atMs: number;
    }
  /** The judging panel completed, after durable freeze and attendance verification. */
  | {
      readonly kind: 'complete_panel';
      readonly completion: RoundPanelCompletion;
      readonly atMs: number;
    }
  /** Capture's readiness for the coming speech. */
  | { readonly kind: 'start_gate'; readonly gate: StartGateEvent }
  /** A server-detected platform incident. */
  | { readonly kind: 'incident'; readonly incident: IncidentEvent };

const advance = (step: RoundStep, rules: RoundRules, atMs: number) =>
  take(step, rules, advanceRoundClock(clockOf(step), rules, atMs));

const factsAt = (
  rules: RoundRules,
  now: number,
  actorId: string | null = null,
): StepFacts => ({ rules, now, actorId });

/** A platform incident: the clock catches up to its instant, then the hold moves. */
const incidentStep = (
  state: RoundState,
  rules: RoundRules,
  event: IncidentEvent,
): RoundStep => {
  const caughtUp = advance(stepFrom(state), rules, event.atMs);
  const before = clockOf(caughtUp).lifecycle.status;
  const moved = take(
    caughtUp,
    rules,
    incidentTransition(clockOf(caughtUp), rules, event),
  );
  if (clockOf(moved).lifecycle.status === before) return moved;
  const ended = withCheckpoint(moved, {
    prep: { phase: 'idle' },
    point_of_information: { phase: 'none' },
  });
  const lastPlayed = clockOf(ended).rows.at(-1)?.endedAtMs;
  return lastPlayed === undefined || lastPlayed === null
    ? ended
    : settleFinalEnd(ended, new Date(lastPlayed).toISOString());
};

/**
 * The Round engine: the next state of a Round and everything the event
 * caused, as data. Pure: no clock, ids, storage or mutation. A refused event
 * throws its typed refusal, and the state it was given is never changed.
 */
export const stepRound = (
  state: RoundState,
  rules: RoundRules,
  event: RoundEvent,
): RoundStep => {
  switch (event.kind) {
    case 'command':
      return applyRoundCommand(
        advance(stepFrom(state), rules, event.atMs),
        factsAt(rules, event.atMs, event.actorId),
        event.command,
      );
    case 'tick':
      return advance(stepFrom(state), rules, event.atMs);
    case 'activate':
      return advance(
        startRound(stepFrom(state), factsAt(rules, event.startedAtMs)),
        rules,
        event.atMs,
      );
    case 'stop': {
      const ending = abandonedLifecycle(state.clock.lifecycle, event.atMs);
      const closed = closePlayedRound(
        stepFrom(state),
        factsAt(rules, event.atMs),
      );
      return withLifecycle(closed, ending);
    }
    case 'adjudicate':
      return applyRoundAdjudication(
        advance(stepFrom(state), rules, event.atMs),
        factsAt(rules, event.atMs),
        event.adjudication,
      );
    case 'complete_panel':
      return applyPanelCompletion(
        stepFrom(state),
        factsAt(rules, event.atMs),
        event.completion,
      );
    case 'start_gate': {
      const at = event.gate.atMs;
      const caughtUp = advance(stepFrom(state), rules, at);
      return advance(
        take(
          caughtUp,
          rules,
          startGateTransition(clockOf(caughtUp), rules.countdownMs, event.gate),
        ),
        rules,
        at,
      );
    }
    case 'incident':
      return incidentStep(state, rules, event.incident);
  }
};
