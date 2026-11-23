import { createElement as h } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  defaultNotificationChoices,
  notificationChoicePairs,
} from '@daisy/protocol/notifications';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { NotificationPreferencesForm } from './notification-preferences-form';

setupRitewayBun();

test('NotificationPreferencesForm', () => {
  const view = renderAccessible(
    h(NotificationPreferencesForm, {
      action: async (previous) => previous,
      choices: {
        ...defaultNotificationChoices,
        friend_request_received: { in_app: true, email: false },
      },
    }),
  );
  const names = view
    .within('form', 'Notification preferences')
    .names('checkbox')
    .map((name) => name.replace(/: (?=[^:]+$)/, ' | '));
  assert({
    given: 'each kind with the channels it is sent on',
    should:
      'name every switch by its kind and channel, so each reads alone and is found by its kind',
    actual: names,
    expected: [
      'A debater I follow is on air | In Daisy',
      'A recording is ready to watch | In Daisy',
      'My Round starts | In Daisy',
      'The decision in my Round is in | In Daisy',
      'The decision in my Round is in | Email',
      'A host invites me to a room | In Daisy',
      'A host invites me to a room | Email',
      'Someone challenges me | In Daisy',
      'Someone accepts my challenge | In Daisy',
      'Someone asks to be friends | In Daisy',
      'Someone asks to be friends | Email',
      'Someone accepts my friend request | In Daisy',
      'A friend request needs my approval | In Daisy',
      'Someone sends me a message request | In Daisy',
      'Someone sends me a message request | Email',
      'I am assigned to judge | In Daisy',
      'My judging assignment is replaced | In Daisy',
      'I am unassigned from judging | In Daisy',
      'My tournament draw changes | In Daisy',
      'My tournament Room is ready | In Daisy',
      'My tournament results are released | In Daisy',
      'My media release request is sent | In Daisy',
      'My media release is declined | In Daisy',
      'My media release is signed | In Daisy',
      'My club confirms my media release | In Daisy',
      'A media release is withdrawn | In Daisy',
      'A student asks my club to confirm their release | In Daisy',
    ],
  });
  assert({
    given: 'friend request email turned off',
    should: 'leave only that switch unchecked',
    actual: [
      view.count('checkbox', undefined, { checked: true }),
      view.names('checkbox', { checked: false }),
    ],
    expected: [
      notificationChoicePairs.length - 1,
      ['Someone asks to be friends: Email'],
    ],
  });
});
