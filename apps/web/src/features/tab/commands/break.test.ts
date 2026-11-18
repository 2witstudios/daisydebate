import { assert, setupRitewayBun, test } from 'riteway/bun';
import { decideAnnounceBreak, type BreakFacts } from './break';
setupRitewayBun();
test('a break announcement records only a completed resolved qualification', () => {
  const base: BreakFacts = {
    eventId: 'event',
    resultsVersion: 7,
    announcedAt: null,
    qualification: 'ready',
  };
  for (const qualification of [
    'results-incomplete',
    'break-not-configured',
    'choices-pending',
  ] as const) {
    assert({
      given: `the actual qualification reports ${qualification}`,
      should: 'refuse without a durable announcement',
      actual: decideAnnounceBreak(
        { ...base, qualification },
        { type: 'announce-break', eventId: 'event' },
      ),
      expected: { kind: 'refused', refusal: qualification },
    });
  }
  assert({
    given: 'a complete resolved break',
    should:
      'record an action fact without persisting computed seeds or advancing the result count',
    actual: decideAnnounceBreak(base, {
      type: 'announce-break',
      eventId: 'event',
    }),
    expected: {
      kind: 'accepted',
      aggregate: { kind: 'event', id: 'event' },
      resultingVersion: 7,
      writes: [],
      findings: [],
      fixtureChanges: [],
    },
  });
  assert({
    given: 'a different addressed event',
    should: 'conceal the foreign event',
    actual: decideAnnounceBreak(base, {
      type: 'announce-break',
      eventId: 'other',
    }),
    expected: { kind: 'refused', refusal: 'not-found' },
  });
  assert({
    given: 'an existing announcement',
    should: 'refuse a different duplicate command',
    actual: decideAnnounceBreak(
      { ...base, announcedAt: '2026-11-16T00:00:00.000Z' },
      { type: 'announce-break', eventId: 'event' },
    ),
    expected: { kind: 'refused', refusal: 'already-announced' },
  });
});
