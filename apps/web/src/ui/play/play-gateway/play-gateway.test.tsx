import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { playOptions } from '../../../features/play/options';
import { PlayGateway } from './play-gateway';

setupRitewayBun();

const html = renderToString(h(PlayGateway, { options: playOptions }));

describe('PlayGateway', () => {
  test('every option is a link to its own page', () => {
    assert({
      given: 'the options',
      should: 'render one link each, to that option',
      actual: playOptions.map((option) =>
        html.includes(`href="${option.href}"`),
      ),
      expected: playOptions.map(() => true),
    });
  });

  test('it is a gateway, not a form', () => {
    assert({
      given: 'the page',
      should: 'name the page and offer no form',
      actual: [
        html.includes('Choose how you want to debate.'),
        html.includes('<form'),
        html.includes('<input'),
      ],
      expected: [true, false, false],
    });
  });

  test('no badge repeats what the title already says', () => {
    assert({
      given: 'the cards',
      should: 'carry an icon, a title and a sentence, and no tag',
      actual: ['>Ranked<', '>Unranked<', '>Anytime<', '>Event<'].map((tag) =>
        html.includes(tag),
      ),
      expected: [false, false, false, false],
    });
  });
});
