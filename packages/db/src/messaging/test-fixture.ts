import type { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import {
  erasePrivacySubject,
  messagingPrivacyExpectedColumns,
} from '../privacy';
import { accountAgePrivacyAdopter } from '../account-age';
import { createMessagingPrivacyAdopter } from './privacy';

/** Isolated integration data only; never collection or production policy authority. */
export async function createMessagingTestFixture(client: SQL) {
  const userId = createId(),
    otherUserId = createId();
  const actorId = createId(),
    otherActorId = createId(),
    channelId = createId();
  const [low, high] = [actorId, otherActorId].sort();
  const now = '2026-10-09T18:00:00.000Z';
  const cleanup = async () => {
    await client.unsafe(
      'delete from messaging_social_commands where actor_id in ($1,$2)',
      [actorId, otherActorId],
    );
    await client.unsafe('delete from messaging_channels where id=$1', [
      channelId,
    ]);
    await client.unsafe(
      'delete from messaging_contact_pairs where low_actor_id=$1 and high_actor_id=$2',
      [low, high],
    );
    await client.unsafe("delete from outbox where payload->>'channelId'=$1", [
      channelId,
    ]);
    await client.unsafe(
      "delete from outbox where kind='messaging.inbox.changed' and payload->>'actorId' in ($1,$2)",
      [actorId, otherActorId],
    );
    await client.unsafe('delete from actors where id in ($1,$2)', [
      actorId,
      otherActorId,
    ]);
    await client.unsafe('delete from account_age where user_id in ($1,$2)', [
      userId,
      otherUserId,
    ]);
    await client.unsafe('delete from users where id in ($1,$2)', [
      userId,
      otherUserId,
    ]);
  };
  try {
    await client.unsafe(
      'insert into users(id,username,email_verified) values($1,$1,true),($2,$2,true)',
      [userId, otherUserId],
    );
    await client.unsafe(
      "insert into actors(id,kind,user_id) values($1,'human',$2),($3,'human',$4)",
      [actorId, userId, otherActorId, otherUserId],
    );
    await client.unsafe(
      "insert into account_age(user_id,birth_month,version,recorded_at) values($1,'2000-01',1,$3),($2,'2000-01',1,$3)",
      [userId, otherUserId, now],
    );
    await seedMessagingTestDm(client, {
      actorId,
      otherActorId,
      channelId,
      now,
    });
    return {
      userId,
      otherUserId,
      actorId,
      otherActorId,
      channelId,
      low,
      high,
      now,
      cleanup,
      eraseSubject: async (subjectActorId: string) => {
        if (![actorId, otherActorId].includes(subjectActorId))
          throw new Error('Fixture actor required');
        const subjectUserId = subjectActorId === actorId ? userId : otherUserId;
        return erasePrivacySubject(
          drizzle({ client }),
          {
            subject: { userId: subjectUserId, actorId: subjectActorId },
            now,
            vendors: [],
            jobIds: [],
          },
          {
            requiredAdopters: [
              {
                id: 'messaging',
                phase: 'before-auth',
                expectedColumns: messagingPrivacyExpectedColumns,
              },
              {
                id: 'account-age',
                phase: 'after-scrub',
                expectedColumns: {
                  account_age: [
                    'user_id',
                    'birth_month',
                    'version',
                    'recorded_at',
                  ],
                },
              },
            ],
            adopters: [
              createMessagingPrivacyAdopter(),
              accountAgePrivacyAdopter,
            ],
          },
          [{ purpose: 'sign-in', subject: 'email' }],
        );
      },
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function seedMessagingTestDm(
  client: SQL,
  {
    actorId,
    otherActorId,
    channelId,
    now,
  }: {
    readonly actorId: string;
    readonly otherActorId: string;
    readonly channelId: string;
    readonly now: string;
  },
) {
  const [low, high] = [actorId, otherActorId].sort();
  await client.unsafe(
    'insert into messaging_contact_pairs(low_actor_id,high_actor_id) values($1,$2)',
    [low, high],
  );
  await client.unsafe(
    "insert into messaging_channels(id,kind,policy_key,policy_revision,lifecycle) values($1,'dm','social.dm',1,'active')",
    [channelId],
  );
  await client.unsafe(
    "insert into messaging_dm_pairs(low_actor_id,high_actor_id,channel_id,request_sender_actor_id,request_state,requested_at,decided_at) values($1,$2,$3,$4,'accepted',$5,$5)",
    [low, high, channelId, actorId, now],
  );
}
