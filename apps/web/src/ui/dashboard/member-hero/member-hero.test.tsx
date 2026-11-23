import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { MemberHero } from './member-hero';

setupRitewayBun();

const roomHref = `/rounds/${'a'.repeat(24)}/room`;

const hrefs = (view: ReturnType<typeof renderAccessible>) =>
  view.all('link').map((link) => link.getAttribute('href'));

describe('MemberHero', () => {
  test('a member without a Room is sent to the Lobby', () => {
    const view = renderAccessible(
      <MemberHero username="ada-byron" activeRoom={null} />,
    );
    assert({
      given: 'a member who holds no Room',
      should:
        'greet them in the h1 and lead with the Lobby, then New room, with no waitlist',
      actual: [
        // The hero's h1 and the phone's own; CSS shows one at a time.
        view.count('heading', 'Welcome back, ada-byron', { level: 1 }),
        hrefs(view),
        view.attribute('link', 'Go to the Lobby', 'href'),
        /waitlist/i.test(view.textContent()) || view.count('textbox') > 0,
      ],
      expected: [2, ['/lobby', '/play/room'], '/lobby', false],
    });
  });

  test('a member in a Room is shown the way back first', () => {
    const view = renderAccessible(
      <MemberHero
        username="ada-byron"
        activeRoom={{
          id: 'b'.repeat(24),
          title: 'Tuesday night',
          phase: 'live',
          href: roomHref,
        }}
      />,
    );
    assert({
      given: 'a member whose Room is live',
      should: 'title the hero with the Room and lead with Return to room',
      actual: [
        view.has('heading', 'Tuesday night', { level: 1 }),
        view.textContent().includes('In progress'),
        hrefs(view),
        view.attribute('link', 'Return to room', 'href'),
      ],
      expected: [true, true, [roomHref, '/lobby'], roomHref],
    });
  });
});
