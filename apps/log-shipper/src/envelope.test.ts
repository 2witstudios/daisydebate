import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseEnvelope } from './envelope';

setupRitewayBun();

const envelope = {
  event: { provider: 'app' },
  fly: {
    app: { instance: '811006b93572d8', name: 'daisy-debate-staging' },
    region: 'ord',
  },
  host: '7b3e',
  log: { level: 'info' },
  message: '{"level":30}',
  timestamp: '2026-10-27T13:01:53.439Z',
};

describe('parseEnvelope', () => {
  test('reads the app, region, instance and line', () => {
    assert({
      given: "a record of Fly's log stream",
      should: 'return its app, region, instance and stdout line only',
      actual: parseEnvelope(JSON.stringify(envelope)),
      expected: {
        app: 'daisy-debate-staging',
        region: 'ord',
        instance: '811006b93572d8',
        message: '{"level":30}',
      },
    });
  });

  test('refuses anything else', () => {
    const bad = [
      'not json',
      JSON.stringify({ ...envelope, message: 42 }),
      JSON.stringify({ ...envelope, fly: { ...envelope.fly, region: 'ORD!' } }),
      JSON.stringify({
        ...envelope,
        fly: { ...envelope.fly, app: { instance: 'x', name: 'Bad Name' } },
      }),
    ];
    assert({
      given: 'malformed JSON, a non-string line or a malformed app or region',
      should: 'return null',
      actual: bad.map(parseEnvelope),
      expected: [null, null, null, null],
    });
  });
});
