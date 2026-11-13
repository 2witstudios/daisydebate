import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  contextChatIdle,
  contextChatUnacknowledged,
} from '../../features/messaging/context-chat/form-state';
import { ContextChatComposer } from './composer';

setupRitewayBun();
const requestId = 'r'.repeat(24);
const initial = contextChatIdle(requestId, 'A kept draft');
const props = {
  id: 'floor-message',
  label: 'Message debaters and host',
  initial,
  maxUnits: 4000,
  action: async () => initial,
  onSent: () => {},
};
test('a chat composer names its audience and submits safely before hydration', () => {
  const html = renderToString(h(ContextChatComposer, props));
  assert({
    given: 'a loaded writable chat channel',
    should:
      'offer an accessible message field and a real form without a GET submission',
    actual: [
      html.includes('name="text"'),
      html.includes('name="requestId"'),
      html.includes('aria-label="Message debaters and host"'),
      html.includes('aria-label="Send message"'),
      /method="get"/i.test(html),
    ],
    expected: [true, true, true, true, false],
  });
});
test('an unknown send keeps the exact retry text read-only', () => {
  const html = renderToString(
    h(ContextChatComposer, {
      ...props,
      initial: contextChatUnacknowledged(initial.values, 'Not confirmed.'),
    }),
  );
  assert({
    given: 'a command whose result has not been confirmed',
    should: 'keep the payload present but prevent editing it and offer retry',
    actual: [
      html.includes('readOnly=""'),
      html.includes('A kept draft'),
      html.includes('aria-label="Retry message"'),
      html.includes(`value="${requestId}"`),
    ],
    expected: [true, true, true, true],
  });
});
test('a locked chat keeps the draft while preventing new sends', () => {
  const html = renderToString(
    h(ContextChatComposer, { ...props, locked: true }),
  );
  assert({
    given: 'a terminal or revoked chat',
    should: 'keep the draft in a read-only field and disable sending',
    actual: [
      html.includes('A kept draft'),
      html.includes('readOnly=""'),
      /<button[^>]*disabled=""/.test(html),
    ],
    expected: [true, true, true],
  });
});
