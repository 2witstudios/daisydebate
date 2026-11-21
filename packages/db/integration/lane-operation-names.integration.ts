import { requireTestServices } from '@daisy/config';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  WORKLOAD_PROFILES,
  createDatabase,
  createRealtimeDatabase,
} from '../src';
import { currentLaneOperation } from '../src/lane-operation';

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
  const database = createDatabase({ url, client, nextActorId: createId });
  try {
    await database.databaseNow();
    await database.authAdapter({}).findOne({ model: 'user', where: [] });
    assert({
      given: 'a clock operation and a nested auth store',
      should: 'reach PostgreSQL under their own operation labels',
      actual: [...new Set(seen)],
      expected: ['databaseNow', 'authAdapter.findOne'],
    });
  } finally {
    await database.close();
    await client.close();
  }
});

test('the realtime factory labels its nested observation read', async () => {
  const { client, seen } = namingClient();
  const database = createRealtimeDatabase({
    url,
    client,
    profile: WORKLOAD_PROFILES['realtime-observer'],
  });
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
    await database.close();
    await client.close();
  }
});
