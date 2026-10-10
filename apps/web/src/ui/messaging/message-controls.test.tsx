import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  MessageMutationFields,
  MessageRemovalFields,
} from './message-mutation-form';
import { ReactionFields } from './reaction-form';
setupRitewayBun();
test('native own-message fields retain escaped drafts and explicit removal while refusing duplicate submission', () => {
  const state = {
    requestId: 'r'.repeat(24),
    text: '<script>private draft</script>',
    notice: 'Your message could not be changed.',
  };
  const ready = renderToStaticMarkup(
    <MessageMutationFields
      answer={state}
      pending={false}
      maxUnits={100}
      action={() => {}}
    />,
  );
  const waiting = renderToStaticMarkup(
    <MessageMutationFields
      answer={{ ...state, next: '/messages/channel' }}
      pending={true}
      maxUnits={100}
      action={() => {}}
    />,
  );
  const removal = renderToStaticMarkup(
    <MessageRemovalFields
      answer={{ requestId: 's'.repeat(24), text: '' }}
      pending={false}
      action={() => {}}
    />,
  );
  assert({
    given: 'refused draft and pending/completed navigation states',
    should:
      'escape content, retain request/text/notice, provide an explicit hidden edit intent, and disable pending submission',
    actual: [
      ready.includes('&lt;script&gt;private draft&lt;/script&gt;'),
      ready.includes('name="operation" value="edit"'),
      removal.includes('name="operation" value="remove"'),
      removal.includes('formNoValidate=""'),
      ready.includes('Your message could not be changed.'),
      ready.toLowerCase().includes('maxlength="100"'),
      ready.includes('disabled=""'),
      (waiting.match(/disabled=""/g) ?? []).length,
    ],
    expected: [true, true, true, true, true, true, false, 2],
  });
});
test('native reactions keep false cleanup intent distinct from addition and escape untrusted displayed choices', () => {
  const own = renderToStaticMarkup(
    <ReactionFields
      answer={{ requestId: 'r'.repeat(24) }}
      pending={false}
      reaction="👍"
      active={false}
    />,
  );
  const held = renderToStaticMarkup(
    <ReactionFields
      answer={{ requestId: 's'.repeat(24), next: '/messages/channel' }}
      pending={false}
      reaction="<img>"
      active={true}
    />,
  );
  assert({
    given: 'current own removal and completed addition action',
    should:
      'render explicit false/true values, remove/add labels, escaped choices and no second completed submission',
    actual: [
      own.includes('name="active" value="false"'),
      own.includes('Remove 👍'),
      own.includes('disabled=""'),
      held.includes('name="active" value="true"'),
      held.includes('React &lt;img&gt;'),
      held.includes('disabled=""'),
    ],
    expected: [true, true, false, true, true, true],
  });
});
