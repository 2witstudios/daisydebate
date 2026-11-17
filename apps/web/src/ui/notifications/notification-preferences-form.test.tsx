import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { defaultNotificationChoices } from '@daisy/protocol';
import { NotificationPreferencesForm } from './notification-preferences-form';

setupRitewayBun();

test('NotificationPreferencesForm', () => {
  const html = renderToStaticMarkup(
    h(NotificationPreferencesForm, {
      action: async (previous) => previous,
      choices: {
        ...defaultNotificationChoices,
        friend_request_received: { in_app: true, email: false },
      },
    }),
  );
  const names = [...html.matchAll(/aria-label="([^"]+): ([^"]+)"/g)].map(
    ([, kind, channel]) => `${kind} | ${channel}`,
  );
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
    ],
  });
  assert({
    given: 'friend request email turned off',
    should: 'leave only that switch unchecked',
    actual: (html.match(/checked=""/g) ?? []).length,
    expected: 11,
  });
});
