import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  ConversationNavigation,
  useConversationAction,
} from './conversation-navigation';
import type { MessageFormState } from '../../features/messaging/forms/send-form';
setupRitewayBun();

test('server rendering retains the exact server action identity', () => {
  const action = async (state: MessageFormState) => state;
  function NativeIdentity() {
    const dispatch = useConversationAction(action, 'server-request');
    return (
      <output>
        {dispatch === action ? 'original server action' : 'wrapped action'}
      </output>
    );
  }
  assert({
    given: 'a server-rendered conversation composer action before hydration',
    should:
      'keep the original server action reference that React uses for native POST and 303',
    actual: renderToStaticMarkup(
      <ConversationNavigation requestId="server-request">
        <NativeIdentity />
      </ConversationNavigation>,
    ),
    expected: '<output>original server action</output>',
  });
});
