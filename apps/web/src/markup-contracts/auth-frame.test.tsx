import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { panelStageColours } from '../ui/test-support/stage-palette';
import { AuthFrame } from '../ui/auth/auth-frame/auth-frame';

setupRitewayBun();

/**
 * The brand panel's surface and palette are a design-system visual contract
 * (ADR 0045): stage ink is cream on cream in light. Read from the class
 * lists; no role carries a colour.
 */
describe('AuthFrame markup', () => {
  test('draws its brand panel on the page palette', () => {
    const page = renderMarkup(
      h(AuthFrame, {
        panel: { eyebrow: 'Why?', title: 'Because.', body: 'Details.' },
        children: null,
      }),
    );
    assert({
      given: 'the brand panel',
      should: 'sit on the overlay surface and use no stage colour',
      actual: {
        overlay: /<aside class="[^"]*\bbg-surface-overlay\b/.test(page),
        stage: panelStageColours(page),
      },
      expected: { overlay: true, stage: [] },
    });
  });
});
