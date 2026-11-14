import {
  oneOnOneDefinition,
  oneOnOneSettings,
} from '@daisy/db/reference-formats';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import type { RoundProjection, RoundRules } from '@daisy/protocol';
import { attempt } from './refusal';
import { corpusAt, seatsOf } from './corpus-seats';
import { hydrate, opening, persisted } from './durable';

type RoundRuntime = ReturnType<typeof hydrate>;

/** The one-on-one rules every ending is played over, with `judges` judge seats. */
export const oneOnOne = (judges = 1): RoundRules => {
  const outcome = resolveRoomConfiguration(
    oneOnOneDefinition,
    oneOnOneSettings,
  );
  if (!outcome.ok) throw new Error(outcome.refusal.message);
  return {
    ...outcome.rules,
    seats: { ...outcome.rules.seats, judge: judges },
  };
};

/** The whole schedule's span: one countdown per segment plus its speech time. */
export const scheduleMs = (rules: RoundRules) =>
  rules.segments.reduce(
    (sum, segment) => sum + rules.countdownMs + segment.durationMs,
    0,
  );

/**
 * A Round as the server runs it: each call's projection is persisted, and a
 * step marked `rehydrated` first rebuilds the runtime from those rows, as the
 * attendance and panel workers do. Every step records what the runtime then
 * exposes.
 */
export const harness = (rules: RoundRules) => {
  const seats = seatsOf(rules);
  let durable = opening;
  let runtime = hydrate(rules, seats, durable);
  const steps: unknown[] = [];
  const record = (
    label: string,
    now: string,
    call: (on: RoundRuntime) => RoundProjection,
    rehydrated = false,
  ) => {
    if (rehydrated) runtime = hydrate(rules, seats, durable);
    const result = attempt(() => call(runtime));
    if (result.ok) durable = persisted(durable, result.value);
    steps.push({
      label,
      now,
      rehydrated,
      result,
      position: runtime.position(now),
      debateOver: runtime.debateOverAt(now),
      checkpoint: runtime.checkpoint(),
    });
  };
  const activate = () =>
    record('activate', corpusAt(0), (on) =>
      on.activate({ at: corpusAt(0), now: corpusAt(0) }),
    );
  const tick = (label: string, ms: number) =>
    record(label, corpusAt(ms), (on) => on.tick(corpusAt(ms)));
  return { seats, steps, record, activate, tick };
};
