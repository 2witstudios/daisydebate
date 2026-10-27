import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { readShipperConfig, subjectsFor } from './config';

setupRitewayBun();

const env = {
  FLY_ORG: 'daisy-debate',
  NATS_TOKEN: 'FlyV1 fm2_not-a-real-token-value',
  SHIPPER_APPS: 'daisy-debate-staging, daisy-debate-staging-realtime',
  CLICKHOUSE_URL: 'http://daisy-debate-staging-clickhouse.internal:8123',
  CLICKHOUSE_SHIPPER_PASSWORD: 'p'.repeat(43),
};

describe('shipper configuration', () => {
  test('reads the app list and defaults the NATS endpoint', () => {
    const config = readShipperConfig(env);
    assert({
      given: 'a complete environment',
      should: "list the apps and default to Fly's 6PN NATS endpoint",
      actual: {
        apps: config.SHIPPER_APPS,
        nats: config.NATS_URL,
        subjects: subjectsFor(config.SHIPPER_APPS),
      },
      expected: {
        apps: ['daisy-debate-staging', 'daisy-debate-staging-realtime'],
        nats: 'nats://[fdaa::3]:4223',
        subjects: [
          'logs.daisy-debate-staging.>',
          'logs.daisy-debate-staging-realtime.>',
        ],
      },
    });
  });

  test('names the bad fields, never their values', () => {
    expect(() =>
      readShipperConfig({
        ...env,
        SHIPPER_APPS: 'logs.>',
        CLICKHOUSE_SHIPPER_PASSWORD: 'short-secret',
      }),
    ).toThrow(
      'Invalid log shipper configuration: SHIPPER_APPS.0, CLICKHOUSE_SHIPPER_PASSWORD',
    );
  });
});
