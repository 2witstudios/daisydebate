import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { lobbyHref, openRoomHref, playOptions } from './options';

setupRitewayBun();

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

  test('ranked first, the room form one option, and neither Play nor the Lobby', () => {
    assert({
      given: 'the options',
      should:
        'lead with ranked, send Open a room to its form, and leave the Lobby to its own link',
      actual: [
        playOptions[0]?.id,
        playOptions.find((option) => option.id === 'room')?.href,
        playOptions.some((option) =>
          ['/play', lobbyHref].includes(option.href),
        ),
      ],
      expected: ['ranked', openRoomHref, false],
    });
  });
});
