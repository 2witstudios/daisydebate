import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { parseCreationForm } from '../../features/messaging/forms/create-form';
import { MessageUserFields } from './message-user-button';
setupRitewayBun();
const requestId = 'r'.repeat(24);
const answer = {
  requestId,
  recipients: 'kelvin',
  title: '',
  introduction: '',
};
const render = (
  state: Parameters<typeof MessageUserFields>[0]['answer'],
  pending = false,
) =>
  renderToStaticMarkup(
    <MessageUserFields
      username="kelvin"
      answer={state}
      pending={pending}
      action={() => {}}
      variant="secondary"
    />,
  );
test('the Message button posts the native direct-request form for one member', () => {
  const html = render(answer);
  assert({
    given: 'a member username',
    should: 'render a submit button named for that member',
    actual: [
      html.includes('aria-label="Message @kelvin"'),
      html.includes('type="submit"'),
      html.includes('>Message</button>'),
    ],
    expected: [true, true, true],
  });
  const form = new FormData();
  for (const [, name, value] of html.matchAll(
    /<input type="hidden" name="([^"]+)" value="([^"]*)"/g,
  ))
    form.set(name!, value!);
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
      render(answer, true).includes('disabled=""'),
      render({ ...answer, next: '/messages/x' }).includes('disabled=""'),
      render(answer).includes('disabled=""'),
    ],
    expected: [true, true, false],
  });
  assert({
    given: 'a refused or failed request',
    should: 'say so without leaking why',
    actual: render({ ...answer, notice: 'Could not start' }).includes(
      'Could not open a conversation with @kelvin. Try again.',
    ),
    expected: true,
  });
});
