import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import type { RoomListQuery } from '@daisy/protocol';
import { discoverRooms } from '../src/room-discovery';
import { withFixture, type Fixture } from './constraint-helpers';
import { createAuthorizationSubject } from './authorization.test-support';
import { validConfig } from './round-fixtures';
import { integrationSuite } from './suite.test-support';

requireTestServices(process.env);
const { databaseUrl } = integrationSuite();

/** One tracked catalog, author and query scope shared by discovery integration proofs. */
async function discoveryFixture(f: Fixture) {
  const caller = await createAuthorizationSubject(f);
  const formatId = await f.format();
  const database = drizzle({ client: f.sql });
  return {
    f,
    caller,
    formatId,
    token: createId(),
    nextId: createId,
    config: validConfig,
    list: (query: RoomListQuery, hidden = false) =>
      database.transaction((tx) =>
        discoverRooms(
          tx,
          caller,
          query,
          () => true,
          () => true,
          () => hidden,
        ),
      ),
  };
}

export const withDiscoveryFixture = (
  run: (fixture: Awaited<ReturnType<typeof discoveryFixture>>) => Promise<void>,
) => withFixture(databaseUrl, async (f) => run(await discoveryFixture(f)));
