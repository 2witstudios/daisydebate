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
      given: 'the judging window of a round',
      should:
        'keep the judge anonymous and writing, and claim nothing about a recording it has no evidence for',
      actual: [
        html.includes('>Judge<'),
        html.includes('>Writing ballot<'),
        html.includes('Recording'),
        html.includes('>Saved<'),
        html.includes('>Not recorded<'),
      ],
      expected: [true, true, false, false, false],
    });
  });
});
