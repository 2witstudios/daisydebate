import {
  assess,
  draw,
  type DrawInput,
  type EventRequest,
  type Fixture,
  type FixtureOf,
  type FourSides,
  type Plan,
  type Speakers,
  type StageHistory,
  type TwoSides,
} from '@daisy/tab-engine';
import { createAppError } from '@daisy/errors';
import type {
  EngineDrawInput,
  EngineEventRequest,
  EngineFixture,
  EnginePlan,
  TabEngine,
} from '../commands/tab-engine';

const twoSides = (fixture: EngineFixture): FixtureOf<TwoSides> | null =>
  fixture.kind === 'bye'
    ? fixture
    : fixture.kind === 'pairing' && fixture.sides.length === 2
      ? { ...fixture, sides: [fixture.sides[0]!, fixture.sides[1]!] }
      : null;
const fourSides = (fixture: EngineFixture): FixtureOf<FourSides> | null =>
  fixture.kind === 'bye'
    ? fixture
    : fixture.kind === 'pairing' && fixture.sides.length === 4
      ? {
          ...fixture,
          sides: [
            fixture.sides[0]!,
            fixture.sides[1]!,
            fixture.sides[2]!,
            fixture.sides[3]!,
          ],
        }
      : null;
const speakers = (fixture: EngineFixture): FixtureOf<Speakers> | null =>
  fixture.kind === 'bye' || fixture.kind === 'section' ? fixture : null;
const stored = <T>(value: T | null): T => {
  if (value === null)
    throw createAppError(
      'INVARIANT',
      'Stored draw fixture differs from its format',
    );
  return value;
};
const isTwoHistory = (
  history: EngineEventRequest['history'],
): history is StageHistory<TwoSides> =>
  history.fixtures.every(({ fixture }) => twoSides(fixture) !== null) &&
  history.results.every(({ outcome }) => outcome.kind === 'winner');
const isFourHistory = (
  history: EngineEventRequest['history'],
): history is StageHistory<FourSides> =>
  history.fixtures.every(({ fixture }) => fourSides(fixture) !== null) &&
  history.results.every(({ outcome }) => outcome.kind === 'ranking');
const isSpeakerHistory = (
  history: EngineEventRequest['history'],
): history is StageHistory<Speakers> =>
  history.fixtures.every(({ fixture }) => speakers(fixture) !== null) &&
  history.results.every(({ outcome }) => outcome.kind === 'ranking');

/** Stored history is checked against the actual event pin before the engine reads it. */
const request = (input: EngineEventRequest): EventRequest => {
  const { format, history, existing } = input;
  if (format.outcome === 'winner' && isTwoHistory(history))
    return {
      ...input,
      format,
      history,
      existing: existing.map((row) => ({
        ...row,
        fixture: stored(twoSides(row.fixture)),
      })),
    };
  if (
    format.outcome === 'ranking' &&
    format.of === 'sides' &&
    isFourHistory(history)
  )
    return {
      ...input,
      format,
      history,
      existing: existing.map((row) => ({
        ...row,
        fixture: stored(fourSides(row.fixture)),
      })),
    };
  if (
    format.outcome === 'ranking' &&
    format.of === 'speakers' &&
    isSpeakerHistory(history)
  )
    return {
      ...input,
      format,
      history,
      existing: existing.map((row) => ({
        ...row,
        fixture: stored(speakers(row.fixture)),
      })),
    };
  throw createAppError(
    'INVARIANT',
    'Stored draw history differs from its format',
  );
};
const inputOf = (input: EngineDrawInput): DrawInput =>
  input.call === 'slot'
    ? { ...input, events: input.events.map(request) }
    : { ...input, event: request(input.event) };

const planWith = <F extends Fixture>(
  plan: EnginePlan,
  parse: (fixture: EngineFixture) => F | null,
) => {
  const keep = plan.keep.map((row) => ({
    ...row,
    fixture: parse(row.fixture),
  }));
  const add = plan.add.map((row) => ({ ...row, fixture: parse(row.fixture) }));
  if (
    keep.some((row) => row.fixture === null) ||
    add.some((row) => row.fixture === null)
  )
    return null;
  return {
    ...plan,
    keep: keep.map((row) => ({ ...row, fixture: stored(row.fixture) })),
    add: add.map((row) => ({ ...row, fixture: stored(row.fixture) })),
  };
};
const planOf = (input: DrawInput, plan: EnginePlan): Plan | null => {
  const event = (input.call === 'slot' ? input.events : [input.event]).find(
    (candidate) => candidate.event === plan.event,
  );
  if (!event) return null;
  if (event.format.outcome === 'winner') return planWith(plan, twoSides);
  return event.format.of === 'sides'
    ? planWith(plan, fourSides)
    : planWith(plan, speakers);
};

/** The actual merged engine, including its persisted reproducibility record and assessment. */
export const tabEngine = {
  draw: (input) => draw(inputOf(input)),
  assess: (input, plans) => {
    const actual = inputOf(input);
    const converted = plans.map((plan) => planOf(actual, plan));
    const answers = assess(
      actual,
      converted.filter((plan) => plan !== null),
    );
    let next = 0;
    return converted.map((plan) =>
      plan === null
        ? {
            fixtures: [],
            totals: [],
            warnings: [],
            broken: [],
            invalid: [{ fact: 'fixture_kind' }],
          }
        : answers[next++]!,
    );
  },
} satisfies TabEngine;
