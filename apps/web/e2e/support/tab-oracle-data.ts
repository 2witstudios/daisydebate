import { SQL } from 'bun';
import { seedHostingGrant } from '../../integration/tab-hosting-grant.test-support';
import { betaAccessTarget } from './beta-access-target';

function hostingGrantDatabase(target: URL) {
  const owner = new URL(process.env.DATABASE_URL ?? 'postgres://invalid');
  if (
    owner.hostname !== target.hostname ||
    owner.port !== target.port ||
    owner.username !== 'daisy' ||
    `${owner.pathname}_e2e` !== target.pathname
  )
    throw new Error(
      'Hosting grants require this E2E database’s migration owner',
    );
  owner.pathname = target.pathname;
  return new SQL(owner.href, { max: 1 });
}

/** Prepare the test hosting entitlement and read fixture facts outside the host views. */
if (import.meta.main) {
  const databaseUrl = betaAccessTarget(process.env);
  const [kind, key, lobbyId] = Bun.argv.slice(2);
  const db = new SQL(databaseUrl, { max: 1 });
  try {
    if (kind === 'actor' && key) {
      const [actor] = await db<{ id: string }[]>`select a.id
        from actors a join users u on u.id = a.user_id where u.username = ${key}`;
      if (!actor) throw new Error('Fixture actor missing');
      process.stdout.write(actor.id);
    } else if (kind === 'hosting-grant' && key) {
      const [user] = await db<
        { id: string }[]
      >`select id from users where username = ${key}`;
      if (!user) throw new Error('Fixture host missing');
      const owner = hostingGrantDatabase(new URL(databaseUrl));
      try {
        await seedHostingGrant(owner, user.id);
      } finally {
        await owner.close();
      }
    } else if ((kind === 'judge' || kind === 'fixture') && key && lobbyId) {
      const value = await db.begin(async (tx) => {
        await tx`select set_config('daisy.lobby_scope', ${lobbyId}, true)`;
        if (kind === 'judge') {
          const [judge] = await tx<
            { id: string }[]
          >`select id from tournament_judges
            where actor_id = ${key} and lobby_id = ${lobbyId}`;
          return judge?.id;
        }
        const [fixture] = await tx<
          { version: number }[]
        >`select version from fixtures
          where id = ${key} and lobby_id = ${lobbyId}`;
        return fixture?.version;
      });
      if (value === undefined)
        throw new Error(`Stored ${kind} fixture missing`);
      process.stdout.write(String(value));
    } else {
      throw new Error(
        'Expected actor or hosting-grant <username>, judge <actor-id> <lobby-id>, or fixture <fixture-id> <lobby-id>',
      );
    }
  } finally {
    await db.close();
  }
}
