import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { screenFor } from '../../../features/ranked/drive-match';
import type { HubScreen } from '../../../features/ranked/drive-match';
import type { RankedRating } from '../../../features/ranked/standing';
import { testSources } from '../../../features/ranked/ranked.test-support';
import { RankedHub } from './ranked-hub';

setupRitewayBun();

const hub = (rating: RankedRating, rules = false): string =>
  renderToString(
    h(RankedHub, {
      screen: screenFor(
        { step: 'hub', rules },
        testSources(rating),
      ) as HubScreen,
    }),
  );

describe('RankedHub', () => {
  test('one heading, one button, two quiet links', () => {
    const html = hub({ kind: 'provisional', value: 1412 });
    assert({
      given: 'a provisional viewer',
      should: 'show Ranked, the rating, Find a match and the two links',
      actual: [
        html.match(/<h1/g)?.length,
        html.includes('>Ranked</h1>'),
        html.includes('>1412<'),
        html.includes('href="/ranked?step=search"'),
        html.includes('href="/ranked?rules=1"'),
        html.includes('href="/ranked/host"'),
        html.includes('<button'),
      ],
      expected: [1, true, true, true, true, true, false],
    });
  });

  test('never shows a queue, a list or a format', () => {
    const html = hub({ kind: 'established', value: 1586 });
    assert({
      given: 'the hub',
      should: 'name no format and list no players',
      actual: /lincoln|public forum|parliamentary|format|<table/i.test(html),
      expected: false,
    });
  });

  test('the rules drawer is closed until asked', () => {
    assert({
      given: 'the hub closed and open',
      should: 'show the drawer only when open',
      actual: [
        hub({ kind: 'unrated' }).includes('Ranked rules</h2>'),
        hub({ kind: 'unrated' }, true).includes('Ranked rules</h2>'),
      ],
      expected: [false, true],
    });
  });
});
