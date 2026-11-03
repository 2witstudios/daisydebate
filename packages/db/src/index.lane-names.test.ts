import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  WORKLOAD_PROFILES,
  createDatabase,
  createRealtimeDatabase,
} from './index';
import { fakeSql } from './index.test-support';
import { currentLaneOperation } from './lane-operation';

setupRitewayBun();

/** A fake client that records the operation each query reaches it under. */
const namingClient = () => {
  const { client } = fakeSql([]);
  const seen: string[] = [];
  const raw = client as unknown as Record<string, unknown>;
  const unsafe = raw.unsafe as (...args: unknown[]) => unknown;
  raw.unsafe = (...args: unknown[]) => {
    seen.push(currentLaneOperation());
    return unsafe(...args);
  };
  return { client, seen };
};
const attempt = async (work: () => unknown) => {
  try {
    await work();
  } catch {
    // The scripted client answers nothing: only the name it was asked under counts.
  }
};
const url = 'postgres://daisy:test@localhost:5432/daisy_test';

test('the database composition names its operations, nested stores included', async () => {
  const { client, seen } = namingClient();
  const database = createDatabase({
    url,
    client,
    nextActorId: () => 'a'.repeat(24),
  }) as unknown as {
    readonly databaseNow: () => unknown;
    readonly authAdapter: (options: object) => {
      readonly findOne: (input: object) => unknown;
    };
    readonly messagingPreferenceStore: (
      fence: unknown,
    ) => Record<string, never>;
  };
  await attempt(() => database.databaseNow());
  await attempt(() =>
    database.authAdapter({}).findOne({ model: 'user', where: [] }),
  );
  assert({
    given: 'a top-level operation and a store a factory hands back',
    should: 'reach the client under their own names',
    actual: [...new Set(seen)],
    expected: ['databaseNow', 'authAdapter.findOne'],
  });
});

test('the realtime composition names its nested reads', async () => {
  const { client, seen } = namingClient();
  const database = createRealtimeDatabase({
    url,
    client,
    profile: WORKLOAD_PROFILES['realtime-observer'],
  }) as unknown as {
    readonly observation: {
      readonly headers: {
        readonly readChannelObservationHeaders: (ids: string[]) => unknown;
      };
    } | null;
  };
  await attempt(() =>
    database.observation?.headers.readChannelObservationHeaders([
      'a'.repeat(24),
    ]),
  );
  assert({
    given: 'an observation read on its own lane',
    should: 'reach the client under its path',
    actual: [...new Set(seen)],
    expected: ['observation.headers.readChannelObservationHeaders'],
  });
});
