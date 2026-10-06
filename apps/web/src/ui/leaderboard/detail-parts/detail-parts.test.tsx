import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { buildDetail } from '../../../features/leaderboard/detail';
import { NOW } from '../../../features/leaderboard/ladder.test-support';
import {
  readDebater,
  readLadder,
} from '../../../features/leaderboard/read-leaderboard';
import { RatingSummary } from './detail-parts';

setupRitewayBun();

describe('RatingSummary', () => {
  test('the stats carry no tier', () => {
    const season = readLadder(4, NOW, null).data.season;
    const detail = buildDetail(
      'debater-b',
      season,
      readDebater('debater-b', 4, NOW, null),
      { view: 'chart', step: null },
      null,
    );
    if (detail.kind !== 'player') throw new Error('expected a player detail');
    const html = renderToString(
      h(RatingSummary, { detail, gridClass: 'grid-cols-4' }),
    );
    const notes = [
      ...html.matchAll(
        /<span class="text-xs text-ink-muted tabular-nums">([^<]*)<\/span>/g,
      ),
    ].map((match) => match[1]);
    assert({
      given: 'an established debater’s rating summary',
      should:
        'note only the rating range, the W–L record and the peak, with no note under the rank',
      actual: notes,
      expected: [detail.range, 'W–L', 'this season'],
    });
  });
});
