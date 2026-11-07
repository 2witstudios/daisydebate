import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { FloorComposer } from './composer';

setupRitewayBun();
const initial = { text: 'A kept draft', requestId: 'r'.repeat(24) };
const props = {
  id: 'floor-message',
  initial,
  maxUnits: 4000,
  action: async () => initial,
  onSent: () => {},
};
test('a floor composer names its audience and submits safely before hydration', () => {
  const html = renderToString(h(FloorComposer, props));
  assert({
    given: 'a loaded writable floor channel',
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
    h(FloorComposer, { ...props, initial: { ...initial, uncertain: true } }),
  );
  assert({
    given: 'a command whose result has not been confirmed',
    should: 'keep the payload present but prevent editing it and offer retry',
    actual: [
      html.includes('readOnly=""'),
      html.includes('A kept draft'),
      html.includes('aria-label="Retry message"'),
      html.includes(`value="${initial.requestId}"`),
    ],
    expected: [true, true, true, true],
  });
});
test('a locked floor keeps the draft while preventing new sends', () => {
  const html = renderToString(h(FloorComposer, { ...props, locked: true }));
  assert({
    given: 'a terminal or revoked floor',
    should: 'keep the draft in a read-only field and disable sending',
    actual: [
      html.includes('A kept draft'),
      html.includes('readOnly=""'),
      /<button[^>]*disabled=""/.test(html),
    ],
    expected: [true, true, true],
  });
});
