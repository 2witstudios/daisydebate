import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { stageColourClasses } from '../ui/test-support/stage-palette';
import { MemberHero } from '../ui/dashboard/member-hero/member-hero';

setupRitewayBun();

const roomHref = `/rounds/${'a'.repeat(24)}/room`;

/**
 * The member hero's phone layout, its photograph and its button surfaces are
 * CSS contracts with no accessible equivalent: which breakpoint hides the
 * hero, which class keeps the phone's heading, the photograph's crop and the
 * secondary action's surface.
 */
describe('MemberHero markup', () => {
  test('on a phone a member without a Room has no hero, only its heading', () => {
    const html = renderMarkup(
      <MemberHero username="ada-byron" activeRoom={null} />,
    );
    assert({
      given: 'a member who holds no Room, on a phone',
      should: 'hide the hero and keep a heading for screen readers',
      actual: [
        /<section class="[^"]*max-narrow:hidden/.test(html),
        /<h1 class="[^"]*hidden[^"]*max-narrow:block[^"]*sr-only|<h1 class="[^"]*sr-only[^"]*hidden[^"]*max-narrow:block/.test(
          html,
        ),
      ],
      expected: [true, true],
    });
  });

  test('on a phone a member in a Room keeps the way back', () => {
    const html = renderMarkup(
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
      given: 'a member who holds a Room, on a phone',
      should: 'keep the hero and its Return to room',
      actual: html.includes('max-narrow:hidden'),
      expected: false,
    });
  });

  test('keeps the Home photograph, not the forest stage', () => {
    const html = renderMarkup(
      <MemberHero username="ada-byron" activeRoom={null} />,
    );
    assert({
      given: 'the member hero (ADR 0069: the stage is for video)',
      should: 'lay the Home photograph under the hero with no stage colour',
      actual: [
        /<img\b[^>]*\bobject-hero-photo\b/.test(html),
        stageColourClasses(html),
      ],
      expected: [true, []],
    });
  });

  test('gives its secondary action an opaque surface over the photograph', () => {
    const html = renderMarkup(
      <MemberHero username="ada-byron" activeRoom={null} />,
    );
    const newRoomTag =
      /<a [^>]*href="\/play\/room"[^>]*>/.exec(html)?.[0] ?? '';
    assert({
      given: 'a member hero laid over the Home photograph',
      should:
        'style New room on the raised surface, not the transparent outline that reads dark-on-dark',
      actual: [
        /\bbg-surface-raised\b/.test(newRoomTag),
        /\bbg-transparent\b/.test(newRoomTag),
      ],
      expected: [true, false],
    });
  });
});
