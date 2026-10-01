import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  isClosed,
  seasonDates,
  seasonLabel,
  seasonProgress,
  type Season,
} from './season';

setupRitewayBun();

const season: Season = {
  id: 4,
  startsAt: '2026-09-01T00:00:00.000Z',
  endsAt: '2026-09-29T00:00:00.000Z',
  status: 'active',
};

describe('season', () => {
  test('label, status and dates', () => {
    assert({
      given: 'an active season',
      should: 'label it, say it is open and print its UTC dates',
      actual: [seasonLabel(season), isClosed(season), seasonDates(season)],
      expected: ['Season 4', false, '1 Sep 2026 to 29 Sep 2026'],
    });
  });

  test('progress', () => {
    assert({
      given: 'times before, during and after the season',
      should: 'count the day within 1..length',
      actual: [
        '2026-08-01T00:00:00.000Z',
        '2026-09-01T00:00:00.000Z',
        '2026-09-15T12:00:00.000Z',
        '2026-12-01T00:00:00.000Z',
      ].map((now) => seasonProgress(season, now)),
      expected: [
        { day: 1, length: 28, percent: 4 },
        { day: 1, length: 28, percent: 4 },
        { day: 15, length: 28, percent: 54 },
        { day: 28, length: 28, percent: 100 },
      ],
    });
  });
});
