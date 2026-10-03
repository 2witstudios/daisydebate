import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { listLive } from '../../../features/watch/list-live';
import { defaultLiveQuery } from '../../../features/watch/live-query';
import { LiveCard } from './live-card';

setupRitewayBun();

describe('LiveCard', () => {
  test('a live debate', () => {
    const card = listLive(defaultLiveQuery).rows.find(
      (row) => row.id === 'finals-rehearsal',
    );
    if (!card) throw new Error('sample missing');
    const html = renderToString(h(LiveCard, { card }));
    assert({
      given: 'the finals rehearsal card',
      should:
        'show title, seats, phase, a ranked chip and one Watch link, and not repeat the delay or standard rules',
      actual: [
        html.includes('Finals rehearsal'),
        html.includes('@debater-c'),
        html.includes('@debater-d'),
        html.includes('Speech [3] · @debater-c speaking'),
        html.includes('>Ranked<'),
        html.includes('31 watching'),
        html.includes('Delayed'),
        html.includes('Standard rules'),
        /<a [^>]*href="\/watch\/finals-rehearsal"/.test(html),
        html.split('<a ').length - 1,
      ],
      expected: [true, true, true, true, true, true, false, false, true, 1],
    });
  });
});
