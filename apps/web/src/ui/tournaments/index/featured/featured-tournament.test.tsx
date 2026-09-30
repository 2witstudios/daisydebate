import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { listTournaments } from '../../../../features/tournaments/list-tournaments';
import { defaultQuery } from '../../../../features/tournaments/query';
import { FeaturedTournament } from './featured-tournament';
import { stageButtonClass } from './stage-button-class';

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

describe('stageButtonClass', () => {
  test('primary and secondary read on the stage', () => {
    assert({
      given: 'both variants',
      should: 'use stage tokens only',
      actual: [
        stageButtonClass('primary').includes(
          'bg-stage-accent text-stage-accent-ink',
        ),
        stageButtonClass('secondary').includes('text-stage-ink'),
      ],
      expected: [true, true],
    });
  });
});
