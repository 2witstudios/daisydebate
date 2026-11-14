import { compareBytes } from '@daisy/seeded-random';
import type { Id } from '../shapes/competition';
import type {
  Draw,
  DrawInput,
  EventRequest,
  ExistingFixture,
} from '../shapes/draw';
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

/** Fact 9: the inputs record names what the draw was computed from. */
export const recordViolations = (
  input: DrawInput,
  request: EventRequest,
  draw: Draw,
): Violation[] => {
  const event = request.event;
  const record = draw.inputs;
  const violations: Violation[] = [];
  const results = resultsDifference(request, record.cutoff, record.results);
  if (results.missing.length > 0 || results.extra.length > 0)
    violations.push({ kind: 'inputs_results', event, ...results });
  const slot = input.call === 'slot' ? input.slot : null;
  if (record.slot !== slot)
    violations.push({
      kind: 'inputs_slot',
      event,
      expected: slot,
      actual: record.slot,
    });
  const existing = difference(
    (request.existing as readonly ExistingFixture<never>[]).map(
      (e) => `${e.id}:${e.hold}`,
    ),
    record.existing.map((e) => `${e.id}:${e.hold}`),
  );
  if (existing.missing.length > 0 || existing.extra.length > 0)
    violations.push({ kind: 'inputs_existing', event, ...existing });
  const commitments = difference(
    input.call === 'slot' ? input.commitments.map((c) => c.fixture) : [],
    record.commitments,
  );
  if (commitments.missing.length > 0 || commitments.extra.length > 0)
    violations.push({ kind: 'inputs_commitments', event, ...commitments });
  return violations;
};
