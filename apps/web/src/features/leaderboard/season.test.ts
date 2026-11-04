import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  isClosed,
  seasonGlance,
  seasonDates,
  seasonLabel,
  seasonProgress,
  type Season,
} from './season';

setupRitewayBun();

const season: Season = {
  id: '4',
  name: 'Season 4',
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

describe('seasonGlance', () => {
  const closed: Season = {
    id: '3',
    name: 'Earlier',
    startsAt: '2026-06-01T00:00:00.000Z',
    endsAt: '2026-07-01T00:00:00.000Z',
    status: 'closed',
  };

  test('numbers the running season by how many have started', () => {
    assert({
      given: 'a closed season, then the running one, listed either way round',
      should: 'call the running one the second season',
      actual: [
        seasonGlance([closed, season], '2026-09-10T00:00:00.000Z')?.number,
        seasonGlance([season, closed], '2026-09-10T00:00:00.000Z')?.number,
      ],
      expected: [2, 2],
    });
  });

  test('says how long is left', () => {
    const lineAt = (now: string) => seasonGlance([season], now)?.line;
    assert({
      given: 'mid-season, the last two days, and a season with no end',
      should: 'count the days left, end today, or give the day',
      actual: [
        lineAt('2026-09-01T12:00:00.000Z'),
        lineAt('2026-09-27T12:00:00.000Z'),
        lineAt('2026-09-28T12:00:00.000Z'),
        seasonGlance([{ ...season, endsAt: null }], '2026-09-12T12:00:00.000Z')
          ?.line,
      ],
      expected: ['27 days left', '1 day left', 'Ends today', 'Day 12'],
    });
  });

  test('says nothing with no running season', () => {
    assert({
      given: 'only closed seasons, and no seasons',
      should: 'give no glance',
      actual: [
        seasonGlance([closed], '2026-09-10T00:00:00.000Z'),
        seasonGlance([], '2026-09-10T00:00:00.000Z'),
      ],
      expected: [null, null],
    });
  });
});
