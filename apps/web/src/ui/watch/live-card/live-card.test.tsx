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
    const html = renderToString(h(LiveCard, { card, delaySeconds: 30 }));
    assert({
      given: 'the finals rehearsal card',
      should: 'show title, seats, phase, delay and one Watch link',
      actual: [
        html.includes('Finals rehearsal'),
        html.includes('@debater-c'),
        html.includes('@debater-d'),
        html.includes('Speech [3] · @debater-c speaking'),
        html.includes('Delayed 30 s'),
        html.includes('31 watching'),
        /<a [^>]*href="\/watch\/finals-rehearsal"/.test(html),
        html.split('<a ').length - 1,
      ],
      expected: [true, true, true, true, true, true, true, 1],
    });
  });
});
