import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { ActiveRoomBar } from '../ui/active-room/active-room-bar';
import { buttonClass } from '../ui/components/button/button-class';
import { stageColourClasses } from '../ui/test-support/stage-palette';
import { YourRoom } from '../ui/active-room/your-room';

setupRitewayBun();

// Markup contract: the room tint, page ink and primary button are design-system
// colour classes (ADR 0069, palette-contrast), with no accessible equivalent.
const roomId = 'a'.repeat(24);
const room = {
  id: roomId,
  title: 'Tuesday night',
  phase: 'assembling',
  href: `/rooms/${roomId}`,
} as const;

describe('YourRoom palette', () => {
  test('sits on the room tint, not the forest stage', () => {
    const html = renderMarkup(<YourRoom room={room} />);
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

describe('ActiveRoomBar palette', () => {
  test('sits on the room tint in page ink, not brand colours', () => {
    const html = renderMarkup(<ActiveRoomBar room={room} />);
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
