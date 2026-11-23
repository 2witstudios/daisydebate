import { renderAccessible } from '../../test-support/rendered/accessible';
import { postsAnyForm } from '../debate-room/posted-fields.test-support';
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
  const view = renderAccessible(
    h(MessageRequestSettingForm, {
      action: async (previous) => previous,
      setting: 'friends',
    }),
  ).within('form', 'Message requests');
  assert({
    given: 'a stored Friends only',
    should: 'offer the three choices with Friends only checked',
    actual: view
      .within('group', 'Who can send me message requests')
      .all('radio')
      .map((radio) => {
        const { value, checked } = radio as HTMLInputElement;
        return `${value}${checked ? ' (checked)' : ''}`;
      }),
    expected: ['everyone', 'friends (checked)', 'none'],
  });
});

test('a guardian-locked message request setting', () => {
  const view = renderAccessible(
    h(MessageRequestSettingForm, {
      action: async (previous) => previous,
      setting: 'friends',
      locked: true,
    }),
  );
  assert({
    given: 'a member whose guardian locks the setting to Friends only',
    should: 'explain the lock and render no way to change the setting',
    actual: {
      disabledChoices: view
        .get('group', 'Who can send me message requests')
        .hasAttribute('disabled'),
      hasSave: postsAnyForm(view),
      explainsLock: view
        .within('form', 'Message requests')
        .textContent()
        .includes('keeps message requests set to Friends'),
    },
    expected: { disabledChoices: true, hasSave: false, explainsLock: true },
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
