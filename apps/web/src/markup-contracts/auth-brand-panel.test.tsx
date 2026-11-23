import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { panelStageColours } from '../ui/test-support/stage-palette';
import { CheckInbox } from '../ui/auth/check-inbox/check-inbox';
import { SavePasskey } from '../ui/auth/save-passkey/save-passkey';

setupRitewayBun();

/**
 * Each auth step's brand panel keeps to the page palette (ADR 0045): stage
 * ink is cream on cream in light. A design-system visual contract read from
 * the class lists; no role carries a colour.
 */
describe('CheckInbox markup', () => {
  test('draws its brand panel in the page palette, not the stage ink', () => {
    const page = renderMarkup(
      h(CheckInbox, {
        email: 'jordan@lincoln.edu',
        resendInMs: 42_000,
        resending: false,
        resend: () => {},
        changeEmail: () => {},
      }),
    );
    assert({
      given: 'the brand panel beside the steps',
      should: 'use no stage colour, which is cream on cream in light',
      actual: panelStageColours(page),
      expected: [],
    });
  });
});

describe('SavePasskey markup', () => {
  test('draws its brand panel in the page palette, not the stage ink', () => {
    const page = renderMarkup(
      h(SavePasskey, {
        username: 'jordan_l',
        pending: false,
        savePasskey: () => {},
        decline: () => {},
      }),
    );
    assert({
      given: 'the brand panel beside the saved facts',
      should: 'use no stage colour, which is cream on cream in light',
      actual: panelStageColours(page),
      expected: [],
    });
  });
});
