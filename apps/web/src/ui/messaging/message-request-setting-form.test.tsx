import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { initialSaveForm } from '../../features/forms/save-form';
import { done, refusedWith } from '../../features/forms/form-state';
import {
  MessageRequestSettingForm,
  shownSetting,
} from './message-request-setting-form';

setupRitewayBun();

test('MessageRequestSettingForm', () => {
  const html = renderToStaticMarkup(
    h(MessageRequestSettingForm, {
      action: async (previous) => previous,
      setting: 'friends',
    }),
  );
  assert({
    given: 'a stored Friends only',
    should: 'offer the three choices with Friends only checked',
    actual: [...html.matchAll(/<input type="radio"[^>]*>/g)].map(([tag]) => {
      const value = /value="(\w+)"/.exec(tag)?.[1];
      return `${value}${tag.includes('checked=""') ? ' (checked)' : ''}`;
    }),
    expected: ['everyone', 'friends (checked)', 'none'],
  });
});

test('shownSetting', () =>
  assert({
    given: 'a refused save of No one, a forged value, idle and a done save',
    should: 'keep the tried choice only when it is a real one',
    actual: [
      shownSetting(refusedWith({ setting: 'none' }, 'x'), 'everyone'),
      shownSetting(refusedWith({ setting: 'forged' }, 'x'), 'everyone'),
      shownSetting(initialSaveForm, 'friends'),
      shownSetting(done(), 'none'),
    ],
    expected: ['none', 'everyone', 'friends', 'none'],
  }));
