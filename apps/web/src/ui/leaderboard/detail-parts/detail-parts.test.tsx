import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { buildDetail } from '../../../features/leaderboard/detail';
import { NOW } from '../../../features/leaderboard/ladder.test-support';
import {
  readDebater,
  readLadder,
} from '../../../features/leaderboard/read-leaderboard.test-support';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { RatingSummary } from './detail-parts';

setupRitewayBun();

describe('RatingSummary', () => {
  test('the stats carry no tier', () => {
    const season = readLadder('4', NOW, null).data.season;
    const detail = buildDetail(
      'debater-b',
      season,
      readDebater('debater-b', '4', NOW, null),
      { view: 'chart', step: null },
      null,
    );
    if (detail.kind !== 'player') throw new Error('expected a player detail');
    const view = renderAccessible(
      h(RatingSummary, { detail, gridClass: 'grid-cols-4' }),
    );
    assert({
      given: 'an established debater’s rating summary',
      should:
        'note only the rating range, the W–L record and the peak, with no note under the rank',
      actual: view.textContent(),
      expected: [
        `Rating${detail.rating}${detail.range}`,
        `Rank${detail.rank}`,
        `Record${detail.record}W–L`,
        `Peak${detail.peak}this season`,
        `Established${detail.statusNote}`,
      ].join(''),
    });
  });
});
