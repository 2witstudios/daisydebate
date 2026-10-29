import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ReadyStep } from './ready';

setupRitewayBun();

const render = (homeHref = '/lobby') =>
  renderToString(h(ReadyStep, { homeHref })).replaceAll('<!-- -->', '');

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

describe('ReadyStep', () => {
  test('one simple send-off', () => {
    const html = render();
    const page = text(html);
    assert({
      given: 'the last step',
      should:
        'offer one CTA to the lobby and the beta line, with nothing else to do',
      actual: [
        page.includes(`You're ready`),
        page.includes(
          'Everything is set up. The lobby is where debates start — jump in whenever you like.',
        ),
        page.includes('Enter the lobby'),
        html.includes('href="/lobby"'),
        page.includes(`You're one of the first inside`),
        [
          page.includes('Debate a bot'),
          page.includes('Debate a real person'),
          page.includes('Edit'),
          page.includes('club'),
        ].some((leftover) => leftover),
      ],
      expected: [true, true, true, true, true, false],
    });
  });
});
