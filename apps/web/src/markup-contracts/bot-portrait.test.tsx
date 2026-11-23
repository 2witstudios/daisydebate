import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import type { PortraitLook } from '../ui/components/bot-portrait/look';
import { BotPortrait } from '../ui/components/bot-portrait/bot-portrait';

setupRitewayBun();

const look: PortraitLook = {
  skin: '#f5d6be',
  hair: '#9c3f2a',
  hairStyle: 'sweep',
  beard: false,
  glasses: 'none',
  lids: 0.1,
  browLift: [0, 7],
  browTilt: -2,
  smile: 0.4,
  outfit: '#2f4858',
  accent: '#f4a261',
  backdrop: '#e0eceb',
};

/**
 * The drawing itself is the subject: its parts (eyes, mouth, brows) are SVG
 * shapes the portrait stylesheet animates by class, and an unlabelled
 * portrait is an `<svg>` with no role, which the accessibility tree the role
 * helper reads cannot tell apart from an exposed one. Neither has a role,
 * name or state to assert instead.
 */
describe('BotPortrait markup', () => {
  test('an unlabelled portrait is decorative', () => {
    const html = renderMarkup(h(BotPortrait, { id: 'pip', look }));
    assert({
      given: 'no label, because the name sits beside it',
      should: 'be hidden from assistive technology',
      actual: [
        html.includes('aria-hidden="true"'),
        html.includes('role="img"'),
      ],
      expected: [true, false],
    });
  });

  test('the drawing covers its whole look vocabulary', () => {
    assert({
      given: 'each shipped hair style and facial option',
      should: 'render a drawing with eyes, mouth and brows',
      actual: [
        ...(['curly', 'sweep', 'sides'] as const).map((hairStyle) => ({
          ...look,
          hairStyle,
        })),
        { ...look, beard: true },
        { ...look, glasses: 'round' as const },
      ].every((variant) => {
        const html = renderMarkup(
          h(BotPortrait, { id: 'pip', look: variant, label: 'Pip' }),
        );
        return (
          html.includes('portrait-blink') &&
          html.includes('portrait-mouth-open') &&
          html.includes('stroke-width="5"')
        );
      }),
      expected: true,
    });
  });
});
