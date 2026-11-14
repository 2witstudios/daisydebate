import { compareBytes } from '@daisy/seeded-random';
import type { Id } from '../shapes/competition';
import type {
  Draw,
  DrawInput,
  EventRequest,
  ExistingFixture,
} from '../shapes/draw';
import { effectiveCutoff } from './context';
import { countedResults, pastFixtures, pastResults } from './past';
import type { Violation } from './verdict';

const sorted = (ids: Iterable<string>) => [...ids].sort(compareBytes);

const difference = (
  expected: readonly string[],
  actual: readonly string[],
) => ({
  missing: sorted(expected.filter((id) => !actual.includes(id))),
  extra: sorted(actual.filter((id) => !expected.includes(id))),
});

/**
 * The results a record names must be exactly one counted result per counted
 * fixture: where the record itself is ambiguous, any of the tied ones.
 */
export const resultsDifference = (
  request: Pick<EventRequest, 'history'>,
  cutoff: number,
  named: readonly Id[],
): { readonly missing: readonly Id[]; readonly extra: readonly Id[] } => {
  const counted = countedResults(
    pastFixtures(request.history),
    pastResults(request.history),
    cutoff,
  );
  const missing: Id[] = [];
  const extra: Id[] = [];
  const accounted = new Set<Id>();
  for (const tied of counted.values()) {
    const ids = tied.map((r) => r.id);
    const hits = named.filter((id) => ids.includes(id));
    if (hits.length === 0) missing.push(sorted(ids)[0]!);
    extra.push(...hits.slice(1));
    for (const id of hits.slice(0, 1)) accounted.add(id);
  }
  extra.push(
    ...named.filter((id) => !accounted.has(id) && !extra.includes(id)),
  );
  return { missing: sorted(missing), extra: sorted(extra) };
};

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** Fact 9: the inputs record names what the draw was computed from. */
export const recordViolations = (
  input: DrawInput,
  request: EventRequest,
  draw: Draw,
): Violation[] => {
  const event = request.event;
  const record = draw.inputs;
  const violations: Violation[] = [];
  if (record.call !== input.call)
    violations.push({
      kind: 'inputs_call',
      event,
      expected: input.call,
      actual: record.call,
    });
  const cutoff = effectiveCutoff(request);
  if (record.cutoff !== cutoff)
    violations.push({
      kind: 'inputs_cutoff',
      event,
      expected: cutoff,
      actual: record.cutoff,
    });
  const results = resultsDifference(request, cutoff, record.results);
  if (results.missing.length > 0 || results.extra.length > 0)
    violations.push({ kind: 'inputs_results', event, ...results });
  const seed = hex(input.seed);
  if (record.seed !== seed)
    violations.push({
      kind: 'inputs_seed',
      event,
      expected: seed,
      actual: record.seed,
    });
  if (input.call === 'slot' && record.call === 'slot') {
    if (record.slot !== input.slot)
      violations.push({
        kind: 'inputs_slot',
        event,
        expected: input.slot,
        actual: record.slot,
      });
    const commitments = difference(
      input.commitments.map((c) => c.fixture),
      record.commitments,
    );
    if (commitments.missing.length > 0 || commitments.extra.length > 0)
      violations.push({ kind: 'inputs_commitments', event, ...commitments });
    const alongside = difference(
      input.events
        .filter((r) => r.event !== event)
        .map((r) => `${r.event}:${r.tabRound}`),
      record.alongside.map((a) => `${a.event}:${a.tabRound}`),
    );
    if (alongside.missing.length > 0 || alongside.extra.length > 0)
      violations.push({ kind: 'inputs_alongside', event, ...alongside });
  }
  const existing = difference(
    (request.existing as readonly ExistingFixture<never>[]).map(
      (e) => `${e.id}:${e.hold}`,
    ),
    record.existing.map((e) => `${e.id}:${e.hold}`),
  );
  if (existing.missing.length > 0 || existing.extra.length > 0)
    violations.push({ kind: 'inputs_existing', event, ...existing });
  const ratings =
    request.ratings === null
      ? null
      : {
          ladder: request.ratings.ladder,
          takenAt: request.ratings.takenAt,
          calculation: request.ratings.calculation,
        };
  const recorded =
    record.ratings === null
      ? null
      : {
          ladder: record.ratings.ladder,
          takenAt: record.ratings.takenAt,
          calculation: record.ratings.calculation,
        };
  if (JSON.stringify(ratings) !== JSON.stringify(recorded))
    violations.push({
      kind: 'inputs_ratings',
      event,
      expected: ratings,
      actual: record.ratings,
    });
  return violations;
};
