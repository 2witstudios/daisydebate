import {
  renderAccessible,
  type AccessibleView,
} from '../../test-support/rendered/accessible';
import { postedBy } from '../test-support/posted-fields.test-support';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  MessageMutationFields,
  MessageRemovalFields,
} from './message-mutation-form';
import { ReactionFields } from './reaction-form';
import { moved } from '../../features/forms/form-state';
import {
  messageIdle,
  messageRefused,
} from '../../features/messaging/forms/send-form';
import { reactionIdle } from '../../features/messaging/forms/reaction-form';
setupRitewayBun();
/** How many of the view's controls are disabled. */
const disabledControls = (view: AccessibleView) =>
  [...view.all('button'), ...view.all('textbox')].filter((control) =>
    control.hasAttribute('disabled'),
  ).length;

test('native own-message fields retain escaped drafts and explicit removal while refusing duplicate submission', () => {
  const state = messageRefused(
    { requestId: 'r'.repeat(24), text: '<script>private draft</script>' },
    'Your message could not be changed.',
  );
  const ready = renderAccessible(
    <MessageMutationFields
      answer={state}
      pending={false}
      maxUnits={100}
      action={() => {}}
    />,
  );
  const waiting = renderAccessible(
    <MessageMutationFields
      answer={moved('/messages/channel')}
      pending={true}
      maxUnits={100}
      action={() => {}}
    />,
  );
  const removal = renderAccessible(
    <MessageRemovalFields
      answer={messageIdle('s'.repeat(24))}
      pending={false}
      action={() => {}}
    />,
  );
  const draft = ready.get('textbox', 'Revise your message');
  assert({
    given: 'refused draft and pending/completed navigation states',
    should:
      'escape content, retain request/text/notice, count instead of truncating, provide an explicit hidden edit intent, and disable pending submission',
    actual: [
      (draft as HTMLTextAreaElement).value,
      postedBy(ready, 'Save message edit')['operation'],
      postedBy(removal, 'Remove your message')['operation'],
      removal
        .get('button', 'Remove your message')
        .hasAttribute('formnovalidate'),
      ready.text('status'),
      draft.hasAttribute('maxlength'),
      ready.textContent().includes('30 / 100 characters'),
      disabledControls(ready),
      disabledControls(waiting),
    ],
    expected: [
      '<script>private draft</script>',
      'edit',
      'remove',
      true,
      'Your message could not be changed.',
      false,
      true,
      0,
      2,
    ],
  });
});
test('native reactions keep false cleanup intent distinct from addition and escape untrusted displayed choices', () => {
  // The fields sit inside the caller's form; a test form stands in for it.
  const own = renderAccessible(
    <form action="/test-form" method="post">
      <ReactionFields
        answer={reactionIdle('r'.repeat(24))}
        pending={false}
        reaction="👍"
        active={false}
      />
    </form>,
  );
  const held = renderAccessible(
    <form action="/test-form" method="post">
      <ReactionFields
        answer={moved('/messages/channel')}
        pending={false}
        reaction="<img>"
        active={true}
      />
    </form>,
  );
  assert({
    given: 'current own removal and completed addition action',
    should:
      'render explicit false/true values, remove/add labels, escaped choices and no second completed submission',
    actual: [
      postedBy(own, 'Remove 👍')['active'],
      own.get('button', 'Remove 👍').hasAttribute('disabled'),
      postedBy(held, 'React <img>')['active'],
      held.get('button', 'React <img>').hasAttribute('disabled'),
      held.count('img'),
    ],
    expected: ['false', false, 'true', true, 0],
  });
});
