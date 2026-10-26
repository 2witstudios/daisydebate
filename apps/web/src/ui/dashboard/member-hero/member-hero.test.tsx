import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { stageColourClasses } from '../../test-support/stage-palette';
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
        /<h1[^>]*>Tuesday night<\/h1>/.test(html),
        html.includes('In progress'),
        html.indexOf(`href="${roomHref}"`) < html.indexOf('href="/lobby"'),
        html.includes('Return to room'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('a raised page card, not the forest stage', () => {
    const html = renderToStaticMarkup(
      <MemberHero username="ada-byron" activeRoom={null} />,
    );
    assert({
      given: 'the member hero (ADR 0069: the stage is for video)',
      should: 'draw on the raised surface with no stage colour',
      actual: [
        /<section class="[^"]*\bbg-surface-raised\b/.test(html),
        stageColourClasses(html),
      ],
      expected: [true, []],
    });
  });
});
