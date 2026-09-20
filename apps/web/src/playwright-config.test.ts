import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import playwrightConfig from '../playwright.config';

setupRitewayBun();

describe('Playwright failure artifacts', () => {
  test('retains screenshots and videos alongside the retained trace', () => {
    assert({
      given: 'a failing browser test',
      should: 'retain all diagnostic artifacts for the failure',
      actual: {
        screenshot: playwrightConfig.use?.screenshot,
        video: playwrightConfig.use?.video,
        trace: playwrightConfig.use?.trace,
      },
      expected: {
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        trace: 'retain-on-failure',
      },
    });
  });
});
