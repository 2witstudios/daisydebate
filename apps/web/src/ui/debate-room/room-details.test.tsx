import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleRound } from '../mock/debate-room.test-support';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { RoomDetails } from './room-details';

setupRitewayBun();

describe('RoomDetails', () => {
  test('the Room tab while the ballots are written', () => {
    const view = renderAccessible(
      h(RoomDetails, { round: sampleRound('judging', 'casual') }),
    );
    const judges = view.within('region', 'Judge').all('listitem');
    const text = view.textContent();
    assert({
      given: 'the judging window of a round',
      should:
        'keep the judge anonymous and writing, and claim nothing about a recording it has no evidence for',
      actual: [
        judges.map((judge) => judge.textContent),
        text.includes('Recording'),
        text.includes('Saved'),
        text.includes('Not recorded'),
      ],
      expected: [['JudgeWriting ballot'], false, false, false],
    });
  });
});
