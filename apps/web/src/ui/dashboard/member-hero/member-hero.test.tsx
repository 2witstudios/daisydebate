import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { MemberHero } from './member-hero';

setupRitewayBun();

const roomHref = `/rounds/${'a'.repeat(24)}/room`;

describe('MemberHero', () => {
  test('a member without a Room is sent to the Lobby', () => {
    const html = renderToStaticMarkup(
      <MemberHero username="ada-byron" activeRoom={null} />,
    );
    assert({
      given: 'a member who holds no Room',
      should:
        'greet them in the h1 and lead with the Lobby, then New room, with no waitlist',
      actual: [
        /<h1[^>]*>Welcome back, ada-byron<\/h1>/.test(html),
        html.indexOf('href="/lobby"') < html.indexOf('href="/play/room"'),
        html.includes('Go to the Lobby'),
        /waitlist|type="email"/i.test(html),
      ],
      expected: [true, true, true, false],
    });
  });

  test('a member in a Room is shown the way back first', () => {
    const html = renderToStaticMarkup(
      <MemberHero
        username="ada-byron"
        activeRoom={{ title: 'Tuesday night', phase: 'live', href: roomHref }}
      />,
    );
    assert({
      given: 'a member whose Room is live',
      should: 'title the hero with the Room and lead with Return to room',
      actual: [
        /<h1[^>]*>Tuesday night<\/h1>/.test(html),
        html.includes('Live'),
        html.indexOf(`href="${roomHref}"`) < html.indexOf('href="/lobby"'),
        html.includes('Return to room'),
      ],
      expected: [true, true, true, true],
    });
  });
});
