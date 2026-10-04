import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleBots } from '../../mock/train-bots';
import { BotPortrait } from './bot-portrait';

setupRitewayBun();

const look = sampleBots[0]?.look ?? (undefined as never);
const render = (props: Partial<Parameters<typeof BotPortrait>[0]> = {}) =>
  renderToString(h(BotPortrait, { id: 'pip', look, ...props }));

describe('BotPortrait', () => {
  test('a labelled portrait is an image', () => {
    const html = render({ label: 'Pip, gentle and shy' });
    assert({
      given: 'a label',
      should: 'be exposed as an image with that name',
      actual: [
        html.includes('role="img"'),
        html.includes('aria-label="Pip, gentle and shy"'),
      ],
      expected: [true, true],
    });
  });

  test('an unlabelled portrait is decorative', () => {
    const html = render();
    assert({
      given: 'no label, because the name sits beside it',
      should: 'be hidden from assistive technology',
      actual: [
        html.includes('aria-hidden="true"'),
        html.includes('role="img"'),
      ],
      expected: [true, false],
    });
  });

  test('speaking is a state of the drawing', () => {
    assert({
      given: 'speaking on and off',
      should: 'say so on the drawing, which the mouth animation reads',
      actual: [
        render({ speaking: true }).includes('data-speaking="true"'),
        render().includes('data-speaking="false"'),
      ],
      expected: [true, true],
    });
  });

  test('framing crops to the face', () => {
    assert({
      given: 'bust and face framing',
      should: 'use a different view box for each',
      actual: [
        render().includes('viewBox="0 0 200 240"'),
        render({ framing: 'face' }).includes('viewBox="38 22 124 164"'),
      ],
      expected: [true, true],
    });
  });

  test('each drawing names its bot', () => {
    assert({
      given: 'two bots drawn on one page',
      should: 'tell their drawings apart',
      actual: [
        render({ id: 'pip' }).includes('data-bot="pip"'),
        render({ id: 'juno' }).includes('data-bot="juno"'),
      ],
      expected: [true, true],
    });
  });

  test('every bot can be drawn', () => {
    assert({
      given: 'every sample bot',
      should: 'render a drawing with eyes, mouth and brows',
      actual: sampleBots.every((bot) => {
        const html = renderToString(
          h(BotPortrait, { id: bot.id, look: bot.look, label: bot.name }),
        );
        return (
          html.includes('portrait-blink') &&
          html.includes('portrait-mouth-open') &&
          html.includes('stroke-width="5"')
        );
      }),
      expected: true,
    });
  });
});

describe('the looks', () => {
  test('no two bots look alike', () => {
    const signature = (look: (typeof sampleBots)[number]['look']) =>
      [look.skin, look.hair, look.hairStyle, look.outfit].join('|');
    assert({
      given: 'the roster',
      should: 'give every bot its own skin, hair and outfit combination',
      actual:
        new Set(sampleBots.map((bot) => signature(bot.look))).size ===
        sampleBots.length,
      expected: true,
    });
  });
});
