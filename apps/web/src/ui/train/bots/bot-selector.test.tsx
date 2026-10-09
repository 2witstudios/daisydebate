import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { botSelector } from '../../../features/train/bots';
import { BotSelectorPage } from './bot-selector';

setupRitewayBun();

const render = (id: string) =>
  renderToString(h(BotSelectorPage, { view: botSelector(id) })).replaceAll(
    '<!-- -->',
    '',
  );

describe('BotSelectorPage', () => {
  test('everything about the chosen bot is on its card', () => {
    const html = render('wren');
    assert({
      given: 'wren chosen',
      should:
        'show its personality, voice and traits and link to canonical room creation',
      actual: [
        html.includes('Quick-witted and dry'),
        html.includes('Crisp and quick, with a dry edge'),
        html.includes('Witty'),
        html.includes('href="/play"'),
        html.includes('Create a debate'),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('no rating and no weak spot', () => {
    const card = /<article.*<\/article>/s.exec(render('wren'))?.[0] ?? '';
    assert({
      given: 'a bot card',
      should: 'not show a rating or a weak spot',
      actual: [card.length > 0, /rating|rated/i.test(card), /weak/i.test(card)],
      expected: [true, false, false],
    });
  });

  test('arrows are links in the middle', () => {
    const html = render('wren');
    assert({
      given: 'a bot in the middle',
      should: 'link to the previous and the next opponent',
      actual: [
        html.includes('aria-label="Previous opponent"'),
        html.includes('aria-label="Next opponent"'),
      ],
      expected: [true, true],
    });
  });

  test('no weaker opponent past the first', () => {
    assert({
      given: 'the first bot',
      should: 'have no live previous-opponent link',
      actual: render('juno').includes('aria-label="Previous opponent"'),
      expected: false,
    });
  });

  test('every bot can be jumped to by avatar', () => {
    const html = render('bram');
    assert({
      given: 'any selection',
      should: 'offer the last bot as a link and mark the chosen one',
      actual: [
        html.includes('aria-label="Bram"'),
        html.includes('aria-current="true"'),
      ],
      expected: [true, true],
    });
  });
});
