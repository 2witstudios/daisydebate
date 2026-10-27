import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ActiveRoomBar, showsActiveRoomBar } from './active-room-bar';
import { buttonClass } from '../components/button/button-class';
import { stageColourClasses } from '../test-support/stage-palette';
import { YourRoom, activeRoomPhaseLabel } from './your-room';

setupRitewayBun();

const roomId = 'a'.repeat(24);
const roomHref = `/rooms/${roomId}`;
const room = {
  id: roomId,
  title: 'Tuesday night',
  phase: 'assembling',
  href: roomHref,
} as const;

describe('activeRoomPhaseLabel', () => {
  test('names each phase', () => {
    assert({
      given: 'an assembling, ready and live Room',
      should:
        'read as the Room page does: Setting up, Ready to start, In progress',
      actual: (['assembling', 'ready', 'live'] as const).map(
        activeRoomPhaseLabel,
      ),
      expected: ['Setting up', 'Ready to start', 'In progress'],
    });
  });
});

describe('YourRoom', () => {
  test('pins the Room with one way back', () => {
    const html = renderToStaticMarkup(<YourRoom room={room} />);
    assert({
      given: "the viewer's assembling Room",
      should: 'name it, its phase, and link Return to room as a document load',
      actual: [
        html.includes('Tuesday night'),
        html.includes('Setting up'),
        new RegExp(`<a[^>]*href="${roomHref}"[^>]*>Return to room</a>`).test(
          html,
        ),
      ],
      expected: [true, true, true],
    });
  });
});

describe('YourRoom palette', () => {
  test('sits on the room tint, not the forest stage', () => {
    const html = renderToStaticMarkup(<YourRoom room={room} />);
    assert({
      given: 'the pinned Room card (ADR 0069: the stage is for video)',
      should:
        'draw on the rooms (teal) tint with page ink and the page primary button',
      actual: {
        teal: /aria-label="Your room" class="[^"]*\bbg-hue-teal-soft\b[^"]*\btext-ink\b/.test(
          html,
        ),
        primary: html.includes(`class="${buttonClass('primary')}`),
        stage: stageColourClasses(html),
      },
      expected: { teal: true, primary: true, stage: [] },
    });
  });
});

describe('showsActiveRoomBar', () => {
  test('hides where the Room is already pinned or open', () => {
    assert({
      given: 'Home, the Lobby, the Room page, a page under it and another page',
      should: 'show the bar only on the other page',
      actual: ['/', '/lobby', roomHref, `${roomHref}/edit`, '/watch'].map(
        (path) => showsActiveRoomBar(path, room),
      ),
      expected: [false, false, false, false, true],
    });
  });

  test('a live Room hides on its Round room and its Room page', () => {
    const live = { id: roomId, href: `/rounds/${'r'.repeat(24)}/room` };
    assert({
      given:
        'a live Room seen from its Round room, its Room page and another page',
      should: 'hide on the first two and show on the last',
      actual: [live.href, roomHref, '/profile'].map((path) =>
        showsActiveRoomBar(path, live),
      ),
      expected: [false, false, true],
    });
  });
});

describe('ActiveRoomBar', () => {
  test('links back to the Room with its title and phase', () => {
    const html = renderToStaticMarkup(
      <ActiveRoomBar room={{ ...room, phase: 'live' }} />,
    );
    assert({
      given: 'a live Room rendered outside a page route',
      should: 'render one link to the Room naming it and In progress',
      actual: [
        (html.match(/<a\b/g) ?? []).length,
        html.includes(`href="${roomHref}"`),
        html.includes('Tuesday night'),
        html.includes(' · In progress'),
        html.includes('Return to room'),
      ],
      expected: [1, true, true, true, true],
    });
  });

  test('sits on the room tint in page ink, not brand colours', () => {
    const html = renderToStaticMarkup(<ActiveRoomBar room={room} />);
    const bar = /<a[^>]*class="([^"]*)"/.exec(html)?.[1] ?? '';
    assert({
      given:
        'the bar on every other shell page (forest on butter is 3.01:1 in dark)',
      should:
        'draw page ink on the rooms (teal) tint, the pair palette-contrast declares, and no forest or butter',
      actual: [
        /\bbg-hue-teal-soft\b/.test(bar),
        /\btext-ink\b/.test(bar),
        /\b(?:bg|text)-(?:forest|butter)\b/.test(html),
      ],
      expected: [true, true, false],
    });
  });
});
