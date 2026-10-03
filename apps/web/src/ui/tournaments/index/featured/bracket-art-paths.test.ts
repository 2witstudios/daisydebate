import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { bracketArt } from './bracket-art-paths';

setupRitewayBun();

const box = { left: 10, right: 100, top: 10, bottom: 40 };

describe('bracketArt', () => {
  test('four entrants: two joins, then the final, then the champion', () => {
    assert({
      given: 'four entrants in a small box',
      should:
        'join each pair, start the next round at the middle of the join, and run the last join to the dot',
      actual: bracketArt(4, box),
      expected: {
        rounds: [
          'M10 10H40V20M10 20H40M10 30H40V40M10 40H40',
          'M40 15H70V35M40 35H70',
        ],
        champion: 'M70 25H100',
        dot: { x: 100, y: 25 },
      },
    });
  });

  test('eight entrants make three rounds of joins', () => {
    const art = bracketArt(8, { left: 12, right: 288, top: 14, bottom: 168 });
    assert({
      given: 'eight entrants',
      should:
        'draw three rounds and end at the right edge, level with the middle',
      actual: [art.rounds.length, art.dot.x, art.dot.y],
      expected: [3, 288, 91],
    });
  });

  test('every round after the first begins where the last one joined', () => {
    const art = bracketArt(8, { left: 12, right: 288, top: 14, bottom: 168 });
    const firstX = (path: string) => /^M(\d+(?:\.\d+)?) /.exec(path)?.[1];
    assert({
      given: 'the three rounds',
      should: 'start each at the previous round’s join, so none floats free',
      actual: art.rounds.map(firstX),
      expected: ['12', '81', '150'],
    });
  });
});
