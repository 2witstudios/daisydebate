import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import playwrightConfig from '../playwright.config';

setupRitewayBun();

describe('Playwright web server shutdown', () => {
  test('signals and awaits each server process itself, never only its shell', () => {
    const servers = Array.isArray(playwrightConfig.webServer)
      ? playwrightConfig.webServer
      : [playwrightConfig.webServer];
    assert({
      given:
        'the configured web and realtime servers, stopped by SIGTERM to their process group',
      should:
        'exec the server in place of the shell, so the run ends only once the server has drained and released its ports (ISSUE-510)',
      actual: servers.map((server) =>
        /&& exec bun /.test(server?.command ?? ''),
      ),
      expected: [true, true],
    });
  });
});
