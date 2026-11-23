import { renderAccessible } from '../../test-support/rendered/accessible';
import { postedBy } from '../debate-room/posted-fields.test-support';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { moved } from '../../features/forms/form-state';
import {
  creationFormUnavailable,
  creationIdle,
  parseCreationForm,
} from '../../features/messaging/forms/create-form';
import { MessageUserFields } from './message-user-button';
setupRitewayBun();
const requestId = 'r'.repeat(24);
const answer = creationIdle(requestId, 'kelvin');
const render = (
  state: Parameters<typeof MessageUserFields>[0]['answer'],
  pending = false,
) =>
  renderAccessible(
    <MessageUserFields
      username="kelvin"
      answer={state}
      pending={pending}
      action={() => {}}
      variant="secondary"
    />,
  );
test('the Message button posts the native direct-request form for one member', () => {
  const view = render(answer);
  assert({
    given: 'a member username',
    should: 'render a submit button named for that member',
    actual: [
      view.attribute('button', 'Message @kelvin', 'type'),
      view.text('button', 'Message @kelvin'),
    ],
    expected: ['submit', 'Message'],
  });
  const form = new FormData();
  for (const [name, value] of Object.entries(postedBy(view, 'Message @kelvin')))
    form.set(name, value);
  assert({
    given: 'the hidden fields the button posts',
    should:
      'parse as a direct request to that member with no introduction, through the existing creation form',
    actual: parseCreationForm('dm', form),
    expected: { version: 1, requestId, recipientUsername: 'kelvin' },
  });
});
test('the Message button refuses double submission and reports a refused request', () => {
  assert({
    given: 'a request on its way or already answered with a destination',
    should: 'disable the button',
    actual: [
      render(answer, true)
        .get('button', 'Message @kelvin')
        .hasAttribute('disabled'),
      render(moved('/messages/x'))
        .get('button', 'Message @kelvin')
        .hasAttribute('disabled'),
      render(answer).get('button', 'Message @kelvin').hasAttribute('disabled'),
    ],
    expected: [true, true, false],
  });
  assert({
    given: 'a refused or failed request',
    should: 'say so without leaking why',
    actual: render(creationFormUnavailable(new FormData())).text('status'),
    expected: 'Could not open a conversation with @kelvin. Try again.',
  });
});
