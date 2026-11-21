import { addMs } from '@daisy/clock';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { requireTestServices } from '@daisy/config';
import { isAppError } from '@daisy/errors';
import type { CompetitionType } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createChallengeStore } from '../src/challenges/store';
import { createMessagingTestFixture } from '../src/testing';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

/**
 * A ranked offer is on one ladder (ADR 0147): the challenge frame reads both
 * members' divisions under the pair's lock, stores the shared one, and
 * refuses across divisions or without one. Casual is always offered.
 */
test('a challenge stays inside one lobby and stores it (ADR 0156)', async () => {
  const client = new SQL(databaseUrl);
  const fixture = await createMessagingTestFixture(client);
  const database = drizzle({ client });
  const store = createChallengeStore({ database, authorize: async () => {} });
  const lobbies = await client<
    { id: string; age_rule: string }[]
  >`select l.id, l.age_rule from lobbies l join organizations o on o.id=l.owner_organization_id where o.official`;
  const youth = lobbies.find((lobby) => lobby.age_rule === 'under-18')!.id;
  const open = lobbies.find((lobby) => lobby.age_rule === 'adults')!.id;
  const now = new Date().toISOString();
  const expiresAt = addMs(now, 600_000);
  const send = (mode: CompetitionType) =>
    store
      .withContacts(
        {
          actorId: fixture.actorId!,
          userId: fixture.userId,
          memberActorIds: [fixture.actorId!, fixture.otherActorId!],
        },
        (frame) =>
          frame.send({
            id: createId(),
            nextId: createId,
            mode,
            format: 'freestyle',
            now,
            expiresAt,
          }),
      )
      .then(
        async ({ challengeId }) => {
          const [row] =
            (await client`select lobby_id from challenges where id=${challengeId}`) as {
              lobby_id: string;
            }[];
          return row ? row.lobby_id : 'missing';
        },
        (error: unknown) => (isAppError(error) ? error.message : 'threw'),
      );
  // An age record held since well before now, so no carry rule moves it.
  const setAge = (userId: string, age: string) =>
    client`insert into account_age (user_id, birth_month, version, recorded_at)
      values (${userId}, to_char(now() - ${age}::interval, 'YYYY-MM'), 1, now() - interval '20 years')
      on conflict (user_id) do update set birth_month = excluded.birth_month,
        version = account_age.version + 1, recorded_at = excluded.recorded_at`;
  const clear = () =>
    client`delete from challenges where challenger_actor_id=${fixture.actorId!}`;
  try {
    await setAge(fixture.userId, '30 years');
    await setAge(fixture.otherUserId, '30 years');
    const bothAdults = await send('ranked');
    await clear();
    await setAge(fixture.otherUserId, '17 years 11 months');
    const acrossLadders = await send('ranked');
    const casualAcross = await send('casual');
    await clear();
    await setAge(fixture.userId, '16 years 6 months');
    const bothYouth = await send('ranked');
    await clear();
    await client`delete from account_age where user_id=${fixture.otherUserId}`;
    const noRecord = await send('ranked');
    await setAge(fixture.userId, '30 years');
    const casualNoRecord = await send('casual');
    assert({
      given:
        'ranked offers between two adults, an adult and a minor, two minors and toward a member with no age record, then casual offers across lobbies and toward no age record',
      should:
        'store the shared lobby on every offer inside one, refuse every offer across lobbies, refuse ranked without an age record, and let casual reach a no-record member in Open',
      actual: {
        bothAdults,
        acrossLadders,
        casualAcross,
        bothYouth,
        noRecord,
        casualNoRecord,
      },
      expected: {
        bothAdults: open,
        acrossLadders: 'other-division',
        casualAcross: 'other-division',
        bothYouth: youth,
        noRecord: 'other-division',
        casualNoRecord: open,
      },
    });
  } finally {
    await clear();
    await fixture.cleanup();
    await client.close();
  }
});
