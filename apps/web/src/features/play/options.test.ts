import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { destinationSlugs } from '../coming-soon/destinations';
import { liveHref } from '../coming-soon/launch';
import { openRoomHref, playOptions, playOptionsFor } from './options';

setupRitewayBun();

const allOpen = Object.fromEntries(
  destinationSlugs.map((slug) => [slug, true]),
) as Parameters<typeof playOptionsFor>[0];

const betaConfig = {
  ...allOpen,
  ranked: false,
  train: false,
  tournaments: false,
};

describe('playOptions', () => {
  test('every way to play leads somewhere of its own', () => {
    assert({
      given: 'the options',
      should: 'have unique ids and unique destinations',
      actual: [
        new Set(playOptions.map((option) => option.id)).size,
        new Set(playOptions.map((option) => option.href)).size,
      ],
      expected: [playOptions.length, playOptions.length],
    });
  });

  test('ranked first once open, the room form one option, and neither Play nor the Lobby', () => {
    const options = playOptionsFor(allOpen);
    assert({
      given: 'every destination launched',
      should:
        'lead with ranked, send Open a room to its form, tag nothing, and leave the Lobby to its own link',
      actual: [
        options[0]?.id,
        options.find((option) => option.id === 'room')?.href,
        options.some((option) => option.comingSoon),
        options.some((option) =>
          ['/play', liveHref('lobby')].includes(option.href),
        ),
      ],
      expected: ['ranked', openRoomHref, false, false],
    });
  });

  test('a way to play that is not open goes to its explainer, after the open ones', () => {
    assert({
      given: 'ranked, train and tournaments not launched',
      should:
        'lead with Open a room, then tag the rest Coming soon and link their explainers',
      actual: playOptionsFor(betaConfig).map(({ id, href, comingSoon }) => [
        id,
        href,
        comingSoon,
      ]),
      expected: [
        ['room', openRoomHref, false],
        ['ranked', '/coming-soon/ranked', true],
        ['bot', '/coming-soon/train', true],
        ['events', '/coming-soon/tournaments', true],
      ],
    });
  });
});
