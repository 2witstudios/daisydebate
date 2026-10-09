import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readRealtimeTransportConfig } from './realtime-transport';
setupRitewayBun();
test('realtime origins are exact and absent configuration denies upgrades', () => {
  assert({
    given: 'empty or explicit origin configuration',
    should: 'keep fail-closed exact origins',
    actual: [
      readRealtimeTransportConfig({}).allowedOrigins,
      readRealtimeTransportConfig({
        REALTIME_ALLOWED_ORIGINS: 'https://daisy.example',
      }).allowedOrigins,
    ],
    expected: [[], ['https://daisy.example']],
  });
});
