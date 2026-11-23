import { createElement as h } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  contextChatIdle,
  contextChatUnacknowledged,
} from '../../features/messaging/context-chat/form-state';
import {
  renderAccessible,
  type AccessibleView,
} from '../../test-support/rendered/accessible';
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
const field = (view: AccessibleView) =>
  view.get('textbox', props.label) as HTMLTextAreaElement;
/** The form the message field posts with: what it sends, by field name. */
const form = (view: AccessibleView) => field(view).form!;
const posted = (view: AccessibleView) =>
  [...form(view).elements].map((element) => element.getAttribute('name'));
test('a chat composer names its audience and submits safely before hydration', () => {
  const view = renderAccessible(h(ContextChatComposer, props));
  assert({
    given: 'a loaded writable chat channel',
    should:
      'offer an accessible message field and a real form without a GET submission',
    actual: [
      field(view).getAttribute('name'),
      posted(view).includes('requestId'),
      view.has('textbox', 'Message debaters and host'),
      view.has('button', 'Send message'),
      form(view).getAttribute('method'),
    ],
    expected: ['text', true, true, true, null],
  });
});
test('an unknown send keeps the exact retry text read-only', () => {
  const view = renderAccessible(
    h(ContextChatComposer, {
      ...props,
      initial: contextChatUnacknowledged(initial.values, 'Not confirmed.'),
    }),
  );
  assert({
    given: 'a command whose result has not been confirmed',
    should: 'keep the payload present but prevent editing it and offer retry',
    actual: [
      field(view).hasAttribute('readonly'),
      field(view).value,
      view.has('button', 'Retry message'),
      (form(view).elements.namedItem('requestId') as HTMLInputElement).value,
    ],
    expected: [true, 'A kept draft', true, requestId],
  });
});
test('a locked chat keeps the draft while preventing new sends', () => {
  const view = renderAccessible(
    h(ContextChatComposer, { ...props, locked: true }),
  );
  assert({
    given: 'a terminal or revoked chat',
    should: 'keep the draft in a read-only field and disable sending',
    actual: [
      field(view).value,
      field(view).hasAttribute('readonly'),
      view.get('button', 'Send message').hasAttribute('disabled'),
    ],
    expected: ['A kept draft', true, true],
  });
});
