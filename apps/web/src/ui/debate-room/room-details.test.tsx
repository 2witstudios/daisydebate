import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleRound } from '../mock/debate-room';
import { RoomDetails } from './room-details';

setupRitewayBun();

describe('RoomDetails', () => {
  test('the Room tab while the ballots are written', () => {
    const html = renderToString(
      h(RoomDetails, { round: sampleRound('judging', 'casual') }),
    );
    assert({
      given: 'the judging window of a recorded round',
      should:
        'keep the judge anonymous and writing, and say what was kept and that this room is not',
      actual: [
        html.includes('>Judge<'),
        html.includes('>Writing ballot<'),
        html.includes('>Saved<'),
        html.includes('>This room now<'),
        html.includes('>Not recorded<'),
      ],
      expected: [true, true, true, true, true],
    });
  });
});
