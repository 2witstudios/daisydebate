import { assert, setupRitewayBun, test } from 'riteway/bun';
import config from '../playwright.config';
setupRitewayBun();
test('default invalid-ticket browser control has an exact admitted origin', () => {
  const realtime = Array.isArray(config.webServer)
    ? config.webServer[1]
    : undefined;
  assert({
    given: 'the harness page served by the configured realtime process',
    should: 'admit only its explicit origin before actual ticket consumption',
    actual: realtime?.env?.REALTIME_ALLOWED_ORIGINS,
    expected: `http://127.0.0.1:${realtime?.env?.REALTIME_PORT}`,
  });
});
