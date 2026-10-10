import { assert, setupRitewayBun, test } from 'riteway/bun';
import { silentLogger } from '../../server/test-loggers.test-support';
import { createMessagingSocialHandlers } from './social-handlers';
setupRitewayBun();
test('social HTTP checks origin and current participant identity before untrusted command or protected preview', async () => {
  const called: string[] = [];
  const operation = async (input: unknown) => {
    called.push('operation');
    return input;
  };
  const handlers = createMessagingSocialHandlers({
    logger: silentLogger,
    origin: () => 'https://daisy.example',
    maxBodyBytes: 512,
    bounds: { introductionUnits: 100, titleUnits: 80, batchActors: 10 },
    identify: async () => {
      called.push('identity');
      return { state: 'anonymous', principal: { kind: 'anonymous' } };
    },
    request: operation,
    decide: operation,
    block: operation,
    preview: operation,
    status: operation,
  });
  const cross = await handlers.decide(
    new Request('https://daisy.example/api/messaging/requests/decide', {
      method: 'POST',
      headers: { origin: 'https://foreign.example' },
      body: '{malformed',
    }),
  );
  assert({
    given: 'a cross-origin decision with malformed JSON',
    should: 'refuse before identity/input/protected work',
    actual: [cross.status, called],
    expected: [403, []],
  });
  const anonymous = await handlers.preview(
    new Request('https://daisy.example/api/messaging/requests/channel'),
    'channel'.padEnd(24, 'x'),
  );
  assert({
    given: 'an anonymous request preview',
    should: 'authenticate before inspecting request content',
    actual: [anonymous.status, called],
    expected: [401, ['identity']],
  });
});
