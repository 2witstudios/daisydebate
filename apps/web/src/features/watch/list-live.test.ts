import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { defaultLiveQuery } from './live-query';
import { listLive } from './list-live';

setupRitewayBun();

describe('listLive over the sample debates', () => {
  test('the default listing', () => {
    const listing = listLive(defaultLiveQuery);
    assert({
      given: 'no filters',
      should:
        'feature the top ranked debate and list the public rest by audience',
      actual: [
        listing.featured?.id,
        listing.rows.map((row) => row.id),
        listing.total,
      ],
      expected: [
        'top-of-the-ladder',
        [
          'packed-house',
          'finals-rehearsal',
          'quarterfinal-practice',
          'serious-only',
          'custom-rules-table',
          'newcomers-round',
          'friendly-spar',
        ],
        8,
      ],
    });
  });

  test('a card carries the speech in progress', () => {
    const card = listLive(defaultLiveQuery).featured;
    assert({
      given: 'the featured debate',
      should: 'show its phase, speaker, progress and audience',
      actual: [
        card?.phaseName,
        card?.speaker,
        card?.progress.join(' '),
        card?.watching,
        card?.aff.speaking,
        card?.neg.speaking,
      ],
      expected: [
        'Speech [3]',
        'debater-a',
        'done done current upcoming upcoming upcoming',
        142,
        true,
        false,
      ],
    });
  });

  test('a filter that matches nothing', () => {
    const listing = listLive({ ...defaultLiveQuery, q: 'zzz' });
    assert({
      given: 'a search matching nothing',
      should: 'list nothing but still count what is live',
      actual: [listing.featured, listing.rows.length, listing.total],
      expected: [null, 0, 8],
    });
  });
});
