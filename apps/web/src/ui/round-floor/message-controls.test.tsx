import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { floorIdle } from '../../features/messaging/round-floor/form-state';
import { FloorMessageControls } from './message-controls';
setupRitewayBun();
const action = async () => floorIdle('r'.repeat(24));
const props = {
  messageId: 'm'.repeat(24),
  changeVersion: 1,
  returnFocusId: 'floor-composer',
  text: 'A message',
  own: true,
  locked: false,
  maxUnits: 4000,
  mutateAction: action,
  reportAction: action,
  onSent: () => {},
};
test('own message controls post scoped edits and removal through an action', () => {
  const html = renderToString(h(FloorMessageControls, props));
  assert({
    given: 'an own floor message',
    should: 'post the message and command identity without query fields',
    actual: [
      html.includes('name="messageId"'),
      html.includes('name="requestId"'),
      html.includes('name="text"'),
      html.includes('value="remove"'),
      /method="get"/i.test(html),
    ],
    expected: [true, true, true, true, false],
  });
});
test('peer reports offer only closed chat reasons', () => {
  const html = renderToString(
    h(FloorMessageControls, { ...props, own: false }),
  );
  assert({
    given: 'a peer floor message',
    should: 'offer chat reporting reasons without a free text or dispute field',
    actual: [
      html.includes('Report reason'),
      html.includes('value="harassment"'),
      html.includes('result_dispute'),
      html.includes('name="text"'),
    ],
    expected: [true, true, false, false],
  });
});
