import { createElement as h } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { contextChatIdle } from '../../features/messaging/context-chat/form-state';
import {
  renderAccessible,
  type AccessibleView,
} from '../../test-support/rendered/accessible';
import { ContextChatMessageControls } from './message-controls';
setupRitewayBun();
const action = async () => contextChatIdle('r'.repeat(24));
const props = {
  messageId: 'm'.repeat(24),
  changeVersion: 1,
  idPrefix: 'floor',
  returnFocusId: 'floor-composer',
  text: 'A message',
  own: true,
  locked: false,
  maxUnits: 4000,
  mutateAction: action,
  reportAction: action,
  onSent: () => {},
};
/** The control's form, found from its submit button: what it posts, by name. */
const form = (view: AccessibleView, submit: string) =>
  (view.get('button', submit) as HTMLButtonElement).form!;
const posted = (view: AccessibleView, submit: string) =>
  [...form(view, submit).elements].map((element) =>
    element.getAttribute('name'),
  );
test('own message controls post scoped edits and removal through an action', () => {
  const view = renderAccessible(h(ContextChatMessageControls, props));
  const fields = posted(view, 'Save edit');
  assert({
    given: 'an own chat message',
    should: 'post the message and command identity without query fields',
    actual: [
      fields.includes('messageId'),
      fields.includes('requestId'),
      view.attribute('textbox', 'Edit message', 'name'),
      view.attribute('option', 'Remove', 'value'),
      form(view, 'Save edit').getAttribute('method'),
    ],
    expected: [true, true, 'text', 'remove', null],
  });
});
test('peer reports offer only closed chat reasons', () => {
  const view = renderAccessible(
    h(ContextChatMessageControls, { ...props, own: false }),
  );
  const reasons = view
    .within('combobox', 'Report reason')
    .all('option')
    .map((option) => option.getAttribute('value'));
  assert({
    given: 'a peer chat message',
    should: 'offer chat reporting reasons without a free text or dispute field',
    actual: [
      view.has('combobox', 'Report reason'),
      reasons.includes('harassment'),
      reasons.includes('result_dispute'),
      posted(view, 'Submit report').includes('text'),
    ],
    expected: [true, true, false, false],
  });
});
