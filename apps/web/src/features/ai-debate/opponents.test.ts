import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { opponentFor } from './opponents';

setupRitewayBun();

describe('opponentFor', () => {
  test('a Train bot is the AI opponent', () => {
    const wren = opponentFor('wren');
    assert({
      given: 'the Wren bot',
      should: "debate as Wren in Deepgram Aura-2's Thalia voice",
      actual: {
        name: wren?.name,
        voice: wren?.voice,
        inCharacter: wren?.persona.includes('You are Wren'),
      },
      expected: { name: 'Wren', voice: 'aura-2-thalia-en', inCharacter: true },
    });
    assert({
      given: 'every bot on the roster',
      should: 'have a distinct voice',
      actual: new Set(
        ['juno', 'wren', 'bram'].map((id) => opponentFor(id)?.voice),
      ).size,
      expected: 3,
    });
  });

  test('an unknown bot is no opponent', () => {
    assert({
      given: 'an id no bot has',
      should: 'be null',
      actual: opponentFor('nobody'),
      expected: null,
    });
  });
});
