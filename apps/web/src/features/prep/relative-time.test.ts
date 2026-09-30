import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ago } from './relative-time';

setupRitewayBun();

const now = '2026-09-30T12:00:00.000Z';
const before = (days: number) =>
  new Date(Date.parse(now) - days * 86_400_000).toISOString();

describe('ago', () => {
  test('whole days back from the injected now', () => {
    assert({
      given: 'instants 0, 1, 2, 6, 7, 13, 14 and 22 days back',
      should: 'read today, yesterday, days, last week, then weeks',
      actual: [0, 1, 2, 6, 7, 13, 14, 22].map((days) => ago(now, before(days))),
      expected: [
        'today',
        'yesterday',
        '2 days ago',
        '6 days ago',
        'last week',
        'last week',
        '2 weeks ago',
        '3 weeks ago',
      ],
    });
  });

  test('a future instant', () => {
    assert({
      given: 'an instant after now',
      should: 'read today rather than a negative span',
      actual: ago(now, before(-3)),
      expected: 'today',
    });
  });
});
