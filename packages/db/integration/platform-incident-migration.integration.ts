import { afterAll } from 'bun:test';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { SQL } from 'bun';
import { Fixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const platformIncident = '20261104002044_platform_incident';
const scratch = scratchDatabase(databaseUrl, 'platformincident');
afterAll(() => scratch.drop());

test(
  'every stored checkpoint gains the incident fields and keeps what it held',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < platformIncident);
    const client = new SQL(scratch.url);
    const f = new Fixture(client);
    try {
      const active = await f.round();
      const [before] =
        await client`select runtime_state from rounds where id=${active}`;
      await scratch.migrate((folder) => folder <= platformIncident);
      const [row] =
        await client`select runtime_state from rounds where id=${active}`;
      const { incident, clock_stops, ...rest } = row!.runtime_state as Record<
        string,
        unknown
      >;
      assert({
        given: 'a Round stored before the platform incident migration',
        should: 'gain no incident and no stops, and keep its checkpoint',
        actual: [incident, clock_stops, rest],
        expected: [{ phase: 'none' }, [], before!.runtime_state],
      });
    } finally {
      await client.close();
    }
  },
  ddlTimeoutMs,
);

const roundStartGate = '20261104023126_round_start_gate';
const gateScratch = scratchDatabase(databaseUrl, 'roundstartgate');
afterAll(() => gateScratch.drop());

test(
  'every stored checkpoint gains an empty start gate and keeps what it held',
  async () => {
    await gateScratch.create();
    await gateScratch.migrate((folder) => folder < roundStartGate);
    const client = new SQL(gateScratch.url);
    const f = new Fixture(client);
    try {
      const active = await f.round();
      const [before] =
        await client`select runtime_state from rounds where id=${active}`;
      await gateScratch.migrate((folder) => folder <= roundStartGate);
      const [row] =
        await client`select runtime_state from rounds where id=${active}`;
      const { start_gate, ...rest } = row!.runtime_state as Record<
        string,
        unknown
      >;
      assert({
        given: 'a Round stored before start gates',
        should: 'gain an empty gate, and keep its checkpoint',
        actual: [start_gate, rest],
        expected: [null, before!.runtime_state],
      });
    } finally {
      await client.close();
    }
  },
  ddlTimeoutMs,
);
