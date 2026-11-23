import { hostWaits } from '@daisy/worker/host';
import { requireTestServices } from '@daisy/config';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { openDatabaseResources, WORKLOAD_PROFILES } from '../src/resources';
import { createAuthStore } from '../src/stores/auth';
import { createChannelObservationStore } from '../src/stores/channel-observation';
import { createRoundStore } from '../src/stores/rounds';
import { currentLaneOperation } from '../src/instrumented';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
const namingClient = () => {
  const client = new SQL(url, { max: 4 });
  const seen: string[] = [];
  const unsafe = client.unsafe.bind(client);
  client.unsafe = (statement, parameters) => {
    seen.push(currentLaneOperation());
    return unsafe(statement, parameters);
  };
  return { client, seen };
};

test('database factory ports keep their operation label through native I/O', async () => {
  const { client, seen } = namingClient();
  const resources = openDatabaseResources({ waits: hostWaits, url, client });
  const rounds = createRoundStore(resources);
  const auth = createAuthStore(resources);
  try {
    await rounds.databaseNow();
    await auth.authAdapter({}).findOne({ model: 'user', where: [] });
    assert({
      given: 'a clock operation and a nested auth store',
      should: 'reach PostgreSQL under their own operation labels',
      actual: [...new Set(seen)],
      expected: ['databaseNow', 'authAdapter.findOne'],
    });
  } finally {
    await resources.close();
    await client.close();
  }
});

test('the realtime factory labels its nested observation read', async () => {
  const { client, seen } = namingClient();
  const resources = openDatabaseResources({
    waits: hostWaits,
    url,
    client,
    profile: WORKLOAD_PROFILES['realtime-observer'],
  });
  const database = createChannelObservationStore(resources);
  try {
    if (!database.observation) throw new Error('Observation port unavailable');
    await database.observation.headers.readChannelObservationHeaders([
      createId(),
    ]);
    assert({
      given: 'a real observation query on its own lane',
      should: 'keep the full operation path',
      actual: [...new Set(seen)],
      expected: ['observation.headers.readChannelObservationHeaders'],
    });
  } finally {
    await resources.close();
    await client.close();
  }
});
