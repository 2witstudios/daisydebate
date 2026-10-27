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
test('production transport caps hold when no override is configured', () => {
  const config = readRealtimeTransportConfig({});
  assert({
    given: 'no transport tuning in the environment',
    should:
      'keep the production per-address, per-member and unauthenticated caps',
    actual: [
      config.maxPerIp,
      config.maxUpgradesPerWindow,
      config.upgradeWindowMs,
      config.maxPerActor,
      config.maxUnauthenticated,
    ],
    expected: [20, 60, 60_000, 8, 4],
  });
});
