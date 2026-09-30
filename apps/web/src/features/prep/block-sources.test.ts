import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { findBlockSources } from './block-sources';

setupRitewayBun();

const now = '2026-09-30T12:00:00.000Z';

describe('findBlockSources', () => {
  test('briefs and cards, never cases', () => {
    const sources = findBlockSources('', now, 160);
    assert({
      given: 'no search',
      should: 'list briefs and cards by title with their detail line',
      actual: [
        sources.length,
        sources.some((s) => s.kind !== 'brief' && s.kind !== 'card'),
        sources.find((s) => s.id === 'framing-pack')?.detail,
        sources.find((s) => s.id === 'cost-estimates')?.detail,
      ],
      expected: [9, false, 'Brief · 3 sections', 'Card · 0:10'],
    });
  });

  test('a search narrows the list', () => {
    assert({
      given: 'a search for "pilot"',
      should: 'find the one card',
      actual: findBlockSources('pilot', now, 160).map((s) => s.id),
      expected: ['pilot-results'],
    });
  });
});
