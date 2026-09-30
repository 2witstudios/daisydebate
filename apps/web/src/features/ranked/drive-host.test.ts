import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { driveHost, hostScreenFor } from './drive-host';

setupRitewayBun();

describe('hostScreenFor', () => {
  test('a provisional host editing', () => {
    const screen = hostScreenFor(
      { step: 'edit', band: 200 },
      {
        rating: { kind: 'provisional', value: 1412 },
        season: { number: 3, daysLeft: 41 },
      },
    );
    assert({
      given: 'a provisional 1412 host within 200',
      should: 'state the rating, the span and the links',
      actual: [
        screen.ratingText,
        screen.seatText,
        screen.bandOptions.map(({ value }) => value),
        screen.formAction,
        screen.cancelHref,
        screen.lobbyHref,
        screen.closeHref,
      ],
      expected: [
        '1412 (provisional)',
        'Ratings 1212 to 1612 can take the seat',
        [100, 200, 300, 0],
        '/ranked/host',
        '/ranked',
        '/lobby',
        '/ranked/host',
      ],
    });
  });

  test('an unrated host', () => {
    const screen = hostScreenFor(
      { step: 'posted', band: 100 },
      { rating: { kind: 'unrated' }, season: { number: 3, daysLeft: 41 } },
    );
    assert({
      given: 'an unrated host with a posted table',
      should: 'say Unrated, open the seat to anyone and keep the band to close',
      actual: [screen.ratingText, screen.seatText, screen.closeHref],
      expected: [
        'Unrated',
        'Any rating can take the seat',
        '/ranked/host?band=100',
      ],
    });
  });
});

describe('driveHost', () => {
  test('reads the sample standing', () => {
    assert({
      given: 'the default query',
      should: 'use the sample provisional rating',
      actual: driveHost({ step: 'edit', band: 200 }).ratingText,
      expected: '1412 (provisional)',
    });
  });
});
