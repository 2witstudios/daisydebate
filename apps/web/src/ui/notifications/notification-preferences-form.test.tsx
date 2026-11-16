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
        challenge_received: { in_app: true, email: false },
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
      'I am assigned to judge | In Daisy',
      'My judging assignment is replaced | In Daisy',
      'I am unassigned from judging | In Daisy',
      'My tournament draw changes | In Daisy',
      'My tournament Room is ready | In Daisy',
      'My tournament results are released | In Daisy',
      'A debater I follow is on air | In Daisy',
      'A recording is ready to watch | In Daisy',
      'A host invites me to a room | In Daisy',
      'A host invites me to a room | Email',
      'Someone challenges me | In Daisy',
      'Someone challenges me | Email',
    ],
  });
  assert({
    given: 'challenge email turned off',
    should: 'leave only that switch unchecked',
    actual: (html.match(/checked=""/g) ?? []).length,
    expected: 11,
  });
});
