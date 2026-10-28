import { createElement as h } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderInStore } from '../test-support/render-in-store';
import { PresenceForm } from './presence-form';

setupRitewayBun();

const action = async () => ({});

test('the presence form offers the opposite of the member’s current choice', () => {
  const render = (hidden: boolean) =>
    renderInStore(h(PresenceForm, { action, hidden }));
  const [hidden, shown] = [render(true), render(false)];
  assert({
    given: 'a member who hides their status, then one who shows it',
    should: 'offer showing it, then hiding it, as one native submit',
    actual: [
      hidden.includes('Show my online status'),
      hidden.includes('name="hidden" value="false"'),
      shown.includes('Hide my online status'),
      shown.includes('name="hidden" value="true"'),
    ],
    expected: [true, true, true, true],
  });
});
