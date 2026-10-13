import { assert, setupRitewayBun, test } from 'riteway/bun';
import playwrightConfig from '../playwright.config';

setupRitewayBun();

test('the browser realtime server unsets the slot projection URL its production config refuses', () => {
  const realtime = Array.isArray(playwrightConfig.webServer)
    ? playwrightConfig.webServer[1]
    : undefined;
  assert({
    given: 'a slot .env that carries the local OBSERVATION_DATABASE_URL',
    should:
      'override it as unset so the production-mode process starts fanout-only',
    actual: {
      overridden:
        realtime?.env !== undefined &&
        'OBSERVATION_DATABASE_URL' in realtime.env,
      value: realtime?.env?.OBSERVATION_DATABASE_URL,
    },
    expected: { overridden: true, value: undefined },
  });
});
