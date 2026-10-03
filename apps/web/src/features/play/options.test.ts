import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { openRoomHref, playOptions } from './options';

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

  test('ranked first, and the room form is one option, not the page', () => {
    assert({
      given: 'the options',
      should: 'lead with ranked and send the practice room to its form',
      actual: [
        playOptions[0]?.id,
        playOptions.find((option) => option.id === 'practice-room')?.href,
        playOptions.some((option) => option.href === '/play'),
      ],
      expected: ['ranked', openRoomHref, false],
    });
  });
});
