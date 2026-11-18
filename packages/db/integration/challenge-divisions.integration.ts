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
test('a ranked challenge stores its ladder division and refuses across ladders', async () => {
  const client = new SQL(databaseUrl);
  const fixture = await createMessagingTestFixture(client);
  const database = drizzle({ client });
  const store = createChallengeStore({ database, authorize: async () => {} });
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.parse(now) + 600_000).toISOString();
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
            (await client`select division from challenges where id=${challengeId}`) as {
              division: string | null;
            }[];
          return row ? row.division : 'missing';
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
    assert({
      given:
        'ranked offers between two adults, an adult and a minor, two minors and toward a member with no age record, and a casual offer across ladders',
      should:
        'store Open and Youth on the same-ladder offers, refuse the cross-ladder and no-record ranked offers with the division reason, and send the casual one with no division',
      actual: { bothAdults, acrossLadders, casualAcross, bothYouth, noRecord },
      expected: {
        bothAdults: 'open',
        acrossLadders: 'ranked-division',
        casualAcross: null,
        bothYouth: 'youth',
        noRecord: 'ranked-division',
      },
    });
  } finally {
    await clear();
    await fixture.cleanup();
    await client.close();
  }
});
