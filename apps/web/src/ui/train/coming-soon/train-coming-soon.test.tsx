import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { TrainComingSoon } from './train-coming-soon';

setupRitewayBun();

describe('TrainComingSoon', () => {
  test('bot debates unreleased to the viewer', () => {
    const view = renderAccessible(h(TrainComingSoon));
    assert({
      given: 'a viewer without the bot-debates release',
      should: 'say bot debates are coming soon, with no button, link or field',
      actual: [
        view.text('heading', 'Train'),
        view.text('paragraph'),
        view.count('button'),
        view.count('link'),
        view.count('textbox') + view.count('combobox') + view.count('radio'),
      ],
      expected: ['Train', 'Bot debates are coming soon.', 0, 0, 0],
    });
  });
});
