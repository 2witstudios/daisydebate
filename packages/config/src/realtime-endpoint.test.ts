import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readRealtimePublicUrl } from './realtime-endpoint';
setupRitewayBun();
test('the public realtime endpoint is optional and has no inferred origin', () => {
  assert({
    given: 'no configured socket endpoint',
    should: 'remain unavailable',
    actual: readRealtimePublicUrl({ NODE_ENV: 'production' }),
    expected: null,
  });
  assert({
    given: 'an explicit secure websocket path',
    should: 'preserve the configured endpoint',
    actual: readRealtimePublicUrl({
      NODE_ENV: 'production',
      REALTIME_PUBLIC_URL: 'wss://socket.daisy.invalid/realtime',
    }),
    expected: 'wss://socket.daisy.invalid/realtime',
  });
});
test('realtime endpoint configuration refuses credentials, wildcards, non websocket URLs and insecure production sockets', () => {
  const values = [
    'https://daisy.invalid/',
    'wss://name:secret@daisy.invalid/',
    'wss://*.daisy.invalid/',
    'wss://daisy.invalid/?token=secret',
    'wss://daisy.invalid/#secret',
    'ws://daisy.invalid/',
    ' wss://daisy.invalid/',
  ];
  assert({
    given: 'unsafe configured production endpoints',
    should: 'refuse every value with a field-only diagnostic',
    actual: values.map((REALTIME_PUBLIC_URL) => {
      try {
        readRealtimePublicUrl({ NODE_ENV: 'production', REALTIME_PUBLIC_URL });
        return 'accepted';
      } catch (error) {
        return (error as Error).message;
      }
    }),
    expected: values.map(
      () => 'Invalid server configuration: REALTIME_PUBLIC_URL',
    ),
  });
});
