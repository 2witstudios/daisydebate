import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import type { PortraitLook } from './look';
import { BotPortrait } from './bot-portrait';

setupRitewayBun();

const look: PortraitLook = {
  skin: '#f5d6be',
  hair: '#9c3f2a',
  hairStyle: 'sweep',
  beard: false,
  glasses: 'none',
  lids: 0.1,
  browLift: [0, 7],
  browTilt: -2,
  smile: 0.4,
  outfit: '#2f4858',
  accent: '#f4a261',
  backdrop: '#e0eceb',
};
/** The portrait, labelled Pip unless the test says otherwise. */
const render = (props: Partial<Parameters<typeof BotPortrait>[0]> = {}) =>
  renderAccessible(h(BotPortrait, { id: 'pip', look, label: 'Pip', ...props }));

describe('BotPortrait', () => {
  test('a labelled portrait is an image', () => {
    const view = render({ label: 'Pip, gentle and shy' });
    assert({
      given: 'a label',
      should: 'be exposed as an image with that name',
      actual: view.has('img', 'Pip, gentle and shy'),
      expected: true,
    });
  });

  test('speaking is a state of the drawing', () => {
    assert({
      given: 'speaking on and off',
      should: 'say so on the drawing, which the mouth animation reads',
      actual: [
        render({ speaking: true }).attribute('img', 'Pip', 'data-speaking'),
        render().attribute('img', 'Pip', 'data-speaking'),
      ],
      expected: ['true', 'false'],
    });
  });

  test('framing crops to the face', () => {
    assert({
      given: 'bust and face framing',
      should: 'use a different view box for each',
      actual: [
        render().attribute('img', 'Pip', 'viewBox'),
        render({ framing: 'face' }).attribute('img', 'Pip', 'viewBox'),
      ],
      expected: ['0 0 200 240', '38 22 124 164'],
    });
  });

  test('each drawing names its bot', () => {
    assert({
      given: 'two bots drawn on one page',
      should: 'tell their drawings apart',
      actual: [
        render({ id: 'pip' }).attribute('img', 'Pip', 'data-bot'),
        render({ id: 'juno' }).attribute('img', 'Pip', 'data-bot'),
      ],
      expected: ['pip', 'juno'],
    });
  });
});
