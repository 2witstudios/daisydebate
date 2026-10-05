import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { hostScreenFor } from '../../features/ranked/drive-host';
import type { HostQuery } from '../../features/ranked/host-query';
import type { RankedRating } from '../../features/ranked/standing';
import { Host } from './host';

setupRitewayBun();

const render = (
  query: HostQuery,
  rating: RankedRating = { kind: 'provisional', value: 1412 },
): string =>
  renderToString(
    h(Host, {
      screen: hostScreenFor(query, {
        rating,
        season: { number: 3, daysLeft: 41 },
      }),
    }),
  );

describe('Host, editing', () => {
  const html = render({ step: 'edit', band: 200 });

  test('a GET form with the band, Post table and Cancel', () => {
    assert({
      given: 'the edit step',
      should: 'be a GET form to the host route with a named select and submit',
      actual: [
        html.includes('method="get"'),
        html.includes('action="/ranked/host"'),
        html.includes('name="band"'),
        /<button[^>]*type="submit"[^>]*value="posted"[^>]*name="step"/.test(
          html,
        ),
        html.includes('>Cancel<'),
        html.includes('href="/ranked"'),
      ],
      expected: [true, true, true, true, true, true],
    });
  });

  test('states the rules and the band', () => {
    assert({
      given: 'a provisional host within 200',
      should: 'say standard rules and the rating span',
      actual: [
        html.includes('Standard rules'),
        html.includes(
          'Your rating: <strong class="text-ink">1412 (provisional)',
        ),
        html.includes('Ratings 1212 to 1612 can take the seat'),
        html.includes(
          '<option value="200" selected="">Within 200 of my rating',
        ),
      ],
      expected: [true, true, true, true],
    });
  });

  test('nothing typed rides in the URL', () => {
    assert({
      given: 'the host form',
      should: 'have no free-text field, only the band and the step buttons',
      actual: /<input[^>]*type="text"/.test(html),
      expected: false,
    });
  });

  test('an unrated host', () => {
    const unrated = render({ step: 'edit', band: 200 }, { kind: 'unrated' });
    assert({
      given: 'an unrated host',
      should: 'say Unrated and open the seat to any rating',
      actual: [
        unrated.includes('>Unrated</strong>'),
        unrated.includes('Any rating can take the seat'),
      ],
      expected: [true, true],
    });
  });

  test('offers casual custom rules through the lobby', () => {
    assert({
      given: 'the rules note',
      should: 'link hosting a casual table to the lobby',
      actual: /href="\/lobby"[^>]*>host a casual table/.test(html),
      expected: true,
    });
  });
});

describe('Host, posted', () => {
  const html = render({ step: 'posted', band: 100 });

  test('confirms the table and links on', () => {
    assert({
      given: 'the posted step',
      should: 'confirm, show the span and link the lobby and Close table',
      actual: [
        html.includes('Your table is in the lobby'),
        html.includes('Ratings 1312 to 1512 can take the seat'),
        html.includes('href="/lobby"'),
        html.includes('href="/ranked/host?band=100"'),
        html.includes('<form'),
      ],
      expected: [true, true, true, true, false],
    });
  });
});
