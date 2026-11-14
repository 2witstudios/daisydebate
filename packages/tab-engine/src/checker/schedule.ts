import { compareBytes, shuffleWith, wordStream } from '@daisy/seeded-random';
import type { Fixture, Id } from '../shapes/competition';
import type {
  DrawInput,
  EventRequest,
  ExistingFixture,
  Plan,
} from '../shapes/draw';
import { fixtureName } from './bracket';
import { entriesToPlace } from './byes';
import { sidesOf } from './context';
import { entriesIn } from './past';
import type { Violation } from './verdict';

/** Whether this request is drawn from the round-robin circle: a two-sided preliminary round-robin round. */
export const isRoundRobin = (request: EventRequest) =>
  request.stage.kind === 'preliminary' &&
  sidesOf(request) === 2 &&
  request.settings['pairing.method'].preliminary.structure === 'round_robin';

/**
 * The circle method over every entry of the event, withdrawn ones included,
 * shuffled once from the call's seed: one seat fixed, the rest turned one
 * place per tab round; seat i meets seat n-1-i, the sides swapped on
 * alternate seats and rounds. An odd field adds an empty seat, a bye.
 */
const circleOf = (request: EventRequest, seed: Uint8Array): Fixture[] => {
  const everyone = request.entries.map((e) => e.id).sort(compareBytes);
  const order: (Id | null)[] = shuffleWith(
    everyone,
    wordStream(
      `daisy-tab-v1/${request.event}/schedule`,
      seed,
      new Uint8Array(),
    ),
  );
  if (order.length % 2 === 1) order.push(null);
  const n = order.length;
  if (n < 2) return [];
  const turn = (request.tabRound - 1) % (n - 1);
  const rest = order.slice(1);
  const turned = [
    order[0]!,
    ...rest.slice(rest.length - turn),
    ...rest.slice(0, rest.length - turn),
  ];
  const fixtures: Fixture[] = [];
  for (let i = 0; i < n / 2; i += 1) {
    const a = turned[i]!;
    const b = turned[n - 1 - i]!;
    if (a === null || b === null) {
      const entry = a ?? b;
      if (entry !== null) fixtures.push({ kind: 'bye', entry });
      continue;
    }
    fixtures.push({
      kind: 'pairing',
      sides: (i + request.tabRound) % 2 === 1 ? [b, a] : [a, b],
      panel: [],
    });
  }
  return fixtures;
};

/**
 * This tab round's scheduled fixtures over the pool (active entries outside
 * fixed fixtures): a fixture of the circle holding anyone outside the pool
 * becomes byes for those of its entries inside it.
 */
export const roundRobinSchedule = (
  input: DrawInput,
  request: EventRequest,
): readonly Fixture[] => {
  const pool = entriesToPlace(request);
  return circleOf(request, input.seed).flatMap((fixture): Fixture[] => {
    const held = entriesIn(fixture);
    if (held.every((e) => pool.has(e))) return [fixture];
    return held
      .filter((e) => pool.has(e))
      .map((entry) => ({ kind: 'bye', entry }));
  });
};

/** Fact 2e: a round-robin round holds, outside its fixed fixtures, exactly its scheduled fixtures. */
export const scheduleViolations = (
  input: DrawInput,
  request: EventRequest,
  plan: Plan,
): Violation[] => {
  if (!isRoundRobin(request)) return [];
  const fixed = new Set(
    (request.existing as readonly ExistingFixture<never>[])
      .filter((e) => e.hold === 'fixed')
      .map((e) => e.id),
  );
  const drawn = [
    ...plan.keep
      .filter((k) => !fixed.has(k.id))
      .map((k) => fixtureName(k.fixture as Fixture)),
    ...plan.add.map((a) => fixtureName(a.fixture as Fixture)),
  ];
  const left = [...drawn];
  const missing: string[] = [];
  for (const name of roundRobinSchedule(input, request).map(fixtureName)) {
    const at = left.indexOf(name);
    if (at < 0) missing.push(name);
    else left.splice(at, 1);
  }
  return missing.length === 0 && left.length === 0
    ? []
    : [
        {
          kind: 'schedule_mismatch',
          event: request.event,
          missing: missing.sort(),
          extra: left.sort(),
        },
      ];
};
