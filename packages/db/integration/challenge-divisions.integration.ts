import { addMs } from '@daisy/clock';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { requireTestServices } from '@daisy/config';
import { isAppError } from '@daisy/errors';
import type { CompetitionType } from '@daisy/protocol/round';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createChallengeStore } from '../src/challenges/store';
import { createMessagingTestFixture } from '../src/testing';
import { Fixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

/**
 * A ranked offer is on one ladder (ADR 0147): the challenge frame reads both
 * members' divisions under the pair's lock, stores the shared one, and
 * refuses across divisions or without one. Casual is always offered.
 */
test('a challenge stays inside one lobby and stores it (ADR 0162)', async () => {
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

test(
  'a ranked challenge rechecks protection after the offer while preserving the Youth lobby',
  async () => {
    const scratch = scratchDatabase(databaseUrl, 'challengeprotection');
    await scratch.create();
    const client = new SQL(scratch.url);
    try {
      await scratch.migrate(() => true);
      const people = await createMessagingTestFixture(client);
      const f = new Fixture(client);
      const guardian = await f.user();
      for (const [userId, years] of [
        [people.userId, '16 years'],
        [people.otherUserId, '16 years'],
        [guardian, '40 years'],
      ]) {
        await client`insert into account_age(user_id,birth_month,version,recorded_at)
        values(${userId},to_char(now() - ${years}::interval,'YYYY-MM'),1,now())
        on conflict (user_id) do update set birth_month=excluded.birth_month,
          version=account_age.version+1, recorded_at=excluded.recorded_at`;
      }
      const evidence = createId();
      await f.insert('guardian_consent_evidence', {
        id: evidence,
        person_user_id: guardian,
        role: 'guardian',
        method: 'created-account',
        notice_kind: 'parental-consent',
        notice_version: 'fixture',
        notice_digest: 'a'.repeat(64),
        recorded_at: new Date(),
      });
      await f.insert('guardian_links', {
        id: createId(),
        guardian_user_id: guardian,
        minor_user_id: people.userId,
        guardian_consent_id: evidence,
        status: 'active',
        activation: 'created-account',
        activated_at: new Date(0),
        created_at: new Date(0),
      });
      const challenger = { actorId: people.actorId!, userId: people.userId };
      const challenged = {
        actorId: people.otherActorId!,
        userId: people.otherUserId,
      };
      const memberActorIds = [challenger.actorId, challenged.actorId];
      const now = new Date().toISOString();
      const expiresAt = addMs(now, 600_000);
      const store = createChallengeStore({
        database: drizzle({ client }),
        authorize: async () => {},
      });
      const { challengeId } = await store.withContacts(
        { ...challenger, memberActorIds },
        (frame) =>
          frame.send({
            id: createId(),
            nextId: createId,
            mode: 'ranked',
            format: 'freestyle',
            now,
            expiresAt,
          }),
      );
      const [offer] =
        await client`select lobby_id from challenges where id=${challengeId}`;
      const [preset] =
        await client`select version, format_version from format_presets
        where format_id='freestyle' and superseded_at is null`;
      const roomId = await f.room(challenged.actorId, 'freestyle', {
        lobby_id: offer!.lobby_id,
        competition_type: 'ranked',
        preset_version: preset!.version,
        format_version: preset!.format_version,
      });
      await client`insert into room_seat_holds(room_id,actor_id,seat,until)
      values(${roomId},${challenger.actorId},'side',${expiresAt})`;
      const protect = (level: 'guided' | 'supervised') =>
        client.begin(async (tx) => {
          await tx`select set_config('daisy.subject_scope',${guardian},true)`;
          await tx`select public.daisy_set_protection_level(${challenger.userId},${JSON.stringify({ level })}::text::jsonb)`;
        });
      const accept = () =>
        store
          .withContacts({ ...challenged, memberActorIds }, (frame) =>
            frame.accept({
              challengeId,
              roomId,
              now,
              followUntil: expiresAt,
              nextId: createId,
            }),
          )
          .then(
            () => 'accepted',
            (error: unknown) => (isAppError(error) ? error.code : 'threw'),
          );
      await protect('supervised');
      const refused = await accept();
      const [before] =
        await client`select room_id from challenges where id=${challengeId}`;
      await protect('guided');
      const control = await accept();
      const [after] =
        await client`select room_id from challenges where id=${challengeId}`;
      assert({
        given:
          'a ranked offer in Youth whose challenger becomes Supervised before acceptance',
        should:
          'leave the offer unaccepted until the challenger is Guided again',
        actual: {
          refused,
          before: before?.room_id,
          control,
          after: after?.room_id,
        },
        expected: {
          refused: 'NOT_FOUND',
          before: null,
          control: 'accepted',
          after: roomId,
        },
      });
    } finally {
      await client.close();
      await scratch.drop();
    }
  },
  ddlTimeoutMs,
);
