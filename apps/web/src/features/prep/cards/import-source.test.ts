import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { importSource } from './import-source';

setupRitewayBun();

describe('importSource', () => {
  test('each outcome', () => {
    assert({
      given: 'no link, a bad link, and links of each kind',
      should: 'classify each',
      actual: [
        '',
        'not a link',
        'https://example.org/unreachable',
        'https://example.org/login/article',
        'https://example.org/scan.pdf',
        'https://example.org/[source-path]',
        'https://example.org/article',
      ].map((url) => importSource(url).kind),
      expected: [
        'idle',
        'invalid',
        'unreachable',
        'login-wall',
        'scan-pdf',
        'duplicate',
        'fetched',
      ],
    });
  });

  test('the duplicate names the saved card', () => {
    assert({
      given: 'the address of a saved card',
      should: 'point at that card',
      actual: importSource('https://example.org/[source-path]'),
      expected: {
        kind: 'duplicate',
        cardId: 'cost-estimates',
        cardTitle: 'Cost estimates depend on assumed take-up',
        savedOn: '[yyyy-mm-dd]',
      },
    });
  });
});
