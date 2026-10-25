import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleRound } from '../mock/debate-room';
import { DrawerRoom } from './drawer-room';

setupRitewayBun();

describe('DrawerRoom', () => {
  test('the Room tab while the ballots are written', () => {
    const html = renderToString(
      h(DrawerRoom, { round: sampleRound('judging', 'casual') }),
    );
    assert({
      given: 'the judging window of a recorded, transcribed round',
      should:
        'keep the judge anonymous and writing, and say what was kept and that this room is not',
      actual: [
        html.includes('>Judge<'),
        html.includes('>Writing ballot<'),
        html.includes('>Saved<'),
        html.includes('>Complete<'),
        html.includes('>This room now<'),
        html.includes('>Not recorded<'),
      ],
      expected: [true, true, true, true, true, true],
    });
  });
});
