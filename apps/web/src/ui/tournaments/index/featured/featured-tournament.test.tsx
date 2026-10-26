import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { listTournaments } from '../../../../features/tournaments/list-tournaments';
import { defaultQuery } from '../../../../features/tournaments/query';
import { FeaturedTournament } from './featured-tournament';
import { stageColourClasses } from '../../../test-support/stage-palette';
import { buttonClass } from '../../../components/button/button-class';

setupRitewayBun();

const render = (signedIn: boolean) => {
  const row = listTournaments(defaultQuery, signedIn).featured;
  return row ? renderToString(h(FeaturedTournament, { row, signedIn })) : '';
};

describe('FeaturedTournament', () => {
  test('signed in and registered: details only', () => {
    const html = render(true);
    assert({
      given: 'the viewer is registered in Autumn Open',
      should: 'offer See details and no Register',
      actual: [
        html.includes('aria-label="Featured tournament"'),
        html.includes('Autumn Open'),
        html.includes('24 of 32 entered.'),
        html.includes('href="/tournaments/autumn-open"'),
        html.includes('>Register<'),
      ],
      expected: [true, true, true, true, false],
    });
  });

  test('signed out: sign in to register, returning to the entry flow', () => {
    const html = render(false);
    assert({
      given: 'an anonymous visitor',
      should:
        'send Sign in to register through sign-in back to /tournaments/enter',
      actual: html.includes(
        'href="/sign-in?next=%2Ftournaments%2Fenter%2Fautumn-open"',
      ),
      expected: true,
    });
  });
});

describe('FeaturedTournament palette', () => {
  test('sits on the competition tint with the page buttons', () => {
    const html = render(false);
    assert({
      given: 'the featured card for a visitor',
      should:
        'draw on the clay tint with the page primary and secondary buttons and no stage colour',
      actual: {
        clay: /aria-label="Featured tournament" class="[^"]*\bbg-hue-clay-soft\b/.test(
          html,
        ),
        primary: html.includes(`class="${buttonClass('primary')}`),
        secondary: html.includes(`class="${buttonClass('secondary')}`),
        stage: stageColourClasses(html),
      },
      expected: { clay: true, primary: true, secondary: true, stage: [] },
    });
  });
});
