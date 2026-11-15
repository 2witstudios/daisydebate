import { afterAll } from 'bun:test';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { assert, test } from 'riteway/bun';
import { createTabStore } from '../src/tab/store';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';
import { integrationSuite } from './suite.test-support';
import { loadSampleTournament } from './tab.test-support';

const { databaseUrl } = integrationSuite();
const scratch = scratchDatabase(databaseUrl, 'tabaccountfence');
afterAll(() => scratch.drop());

const fenceReached = async (
  observer: SQL,
  pid: number,
  blocker: number,
  loaded: () => boolean,
): Promise<string> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (loaded()) return 'aggregate loaded';
    const [row] =
      await observer`select pg_blocking_pids(${pid}::integer) as blockers`;
    if ((row?.blockers as number[] | undefined)?.includes(blocker))
      return 'account fence';
    await Bun.sleep(20);
  }
  throw new Error('Tab command did not reach its account fence');
};

/** The holder account must be locked before the organization, including remove-grant. */
test(
  'revoking a lobby grant fences its holder before the organization',
  async () => {
    await scratch.create();
    await scratch.migrate(() => true);
    const holder = new SQL(scratch.url, { max: 1 });
    const revoker = new SQL(scratch.url, { max: 1 });
    const observer = new SQL(scratch.url, { max: 1 });
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let running: Promise<void> | null = null;
    let loaded = false;
    try {
      await holder.unsafe('begin');
      const ids = await loadSampleTournament(holder);
      for (const userId of [ids.owner, ids.staff]) {
        await holder`insert into actors (id, kind, user_id) values (${createId()}, 'human', ${userId})`;
      }
      await holder.unsafe('commit');
      const [holding] = await holder`select pg_backend_pid() as pid`;
      const [revoking] = await revoker`select pg_backend_pid() as pid`;
      await holder.unsafe('begin');
      await holder`select id from users where id = ${ids.staff} for update`;
      await revoker.unsafe('set role daisy_web');
      const store = createTabStore(drizzle({ client: revoker }));
      running = store.organizationCommand(
        {
          senderUserId: ids.owner,
          command: {
            type: 'remove-grant',
            grantId: ids.staffGrant,
            scope: { kind: 'lobby', lobbyId: ids.lobby },
          },
          newId: createId(),
          now: '2027-03-06T09:00:00.000Z',
        },
        async (session) => {
          await session.load();
          loaded = true;
          await released;
        },
      );
      const fence = await fenceReached(
        observer,
        Number(revoking!.pid),
        Number(holding!.pid),
        () => loaded,
      );
      await observer.unsafe('begin');
      let organizationFree = true;
      try {
        await observer`select id from organizations where id = ${ids.league} for update nowait`;
      } catch (error) {
        if ((error as { errno?: string }).errno !== '55P03') throw error;
        organizationFree = false;
      } finally {
        await observer.unsafe('rollback');
      }
      assert({
        given: 'a grant holder locked by another authority change',
        should: 'wait for that account before locking the grant organization',
        actual: { fence, organizationFree },
        expected: { fence: 'account fence', organizationFree: true },
      });
      await holder.unsafe('commit');
      release();
      await running;
      assert({
        given: 'the account fence released',
        should: 'finish loading the command',
        actual: loaded,
        expected: true,
      });
    } finally {
      release();
      await holder.unsafe('rollback');
      if (running) await Promise.allSettled([running]);
      await Promise.all([holder.close(), revoker.close(), observer.close()]);
    }
  },
  ddlTimeoutMs,
);
