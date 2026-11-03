import { expect } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readWorkerConfig } from './config';

setupRitewayBun();

const env = {
  RECORDING_WORKER_DATABASE_URL: 'postgres://w@db/daisy',
  RECORDING_HOLD_ENDPOINT: 'https://fly.storage.tigris.dev',
  RECORDING_HOLD_BUCKET: 'hold',
  RECORDING_HOLD_KEY: 'k',
  RECORDING_HOLD_SECRET: 's',
  RECORDING_BUCKET_ENDPOINT: 'https://fly.storage.tigris.dev',
  RECORDING_BUCKET_NAME: 'recordings',
  RECORDING_BUCKET_ACCESS_KEY_ID: 'k',
  RECORDING_BUCKET_SECRET_ACCESS_KEY: 's',
};

test('readWorkerConfig', () => {
  assert({
    given: 'every setting',
    should: 'default to one slot, so one build has the whole machine',
    actual: readWorkerConfig(env).RECORDING_WORKER_SLOTS,
    expected: 1,
  });
  expect(() =>
    readWorkerConfig({ ...env, RECORDING_HOLD_BUCKET: undefined }),
  ).toThrow('RECORDING_HOLD_BUCKET');
});
