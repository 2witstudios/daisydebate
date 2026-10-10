import { accountAgePrivacyAdopter } from '../src/account-age';
import { createMessagingPrivacyAdopter } from '../src/messaging/privacy';
import { createId } from '@paralleldrive/cuid2';
import { eq } from 'drizzle-orm';
import { actors } from '../src/schema/actors';
import {
  messagingChannels,
  messagingActorStates,
} from '../src/schema/messaging-channels';
import {
  messagingContactPairs,
  messagingDmPairs,
  messagingGroupGrants,
  messagingGroupInvitations,
  messagingSocialCommands,
} from '../src/schema/messaging-social';
import {
  messagingMessages,
  messagingReceipts,
  messagingReactions,
} from '../src/schema/messaging-messages';
import { messagingPrivacyExpectedColumns } from '../src/privacy';
import { now, withPrivacySubject } from './privacy.test-support';

export const messagingRequiredAdopters = [
  {
    id: 'messaging',
    phase: 'before-auth' as const,
    expectedColumns: messagingPrivacyExpectedColumns,
  },
  {
    id: 'account-age',
    phase: 'after-scrub' as const,
    expectedColumns: {
      account_age: ['user_id', 'birth_month', 'version', 'recorded_at'],
    },
  },
];
export const messagingPrivacyAdoption = {
  requiredAdopters: messagingRequiredAdopters,
  adopters: [createMessagingPrivacyAdopter(), accountAgePrivacyAdopter],
};

/** Composes real MSG-owned tables through Drizzle; no alternative contact backend. */
export async function withPrivacyMessaging(
  run: (
    input: Parameters<Parameters<typeof withPrivacySubject>[0]>[0] & {
      otherActorId: string;
      dmId: string;
      groupId: string;
      ownMessageId: string;
      otherMessageId: string;
    },
  ) => Promise<void>,
) {
  await withPrivacySubject(async (context) => {
    const { database, client, userId, actorId, otherId } = context;
    const [
      otherActorId,
      dmId,
      groupId,
      ownMessageId,
      otherMessageId,
      requestId,
    ] = Array.from({ length: 6 }, () => createId()) as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const [lowActorId, highActorId] = [actorId, otherActorId].sort() as [
      string,
      string,
    ];
    const timestamp = new Date(now);
    try {
      await database
        .insert(actors)
        .values({ id: otherActorId, kind: 'human', userId: otherId });
      await database.insert(messagingChannels).values([
        {
          id: dmId,
          kind: 'dm',
          policyKey: 'social.dm',
          policyRevision: 1,
          lifecycle: 'active',
          messageSequence: 2,
          changeVersion: 2,
          createdAt: timestamp,
        },
        {
          id: groupId,
          kind: 'private_group',
          policyKey: 'social.private_group',
          policyRevision: 1,
          lifecycle: 'active',
          title: 'Peer-authored shared title',
          titleAuthorActorId: otherActorId,
          createdAt: timestamp,
        },
      ]);
      await database.insert(messagingContactPairs).values({
        lowActorId,
        highActorId,
        lowBlocksHigh: actorId !== lowActorId,
        highBlocksLow: actorId !== highActorId,
      });
      await database.insert(messagingDmPairs).values({
        lowActorId,
        highActorId,
        channelId: dmId,
        requestSenderActorId: actorId,
        requestState: 'accepted',
        introduction: 'Subject introduction',
        requestedAt: timestamp,
        decidedAt: timestamp,
      });
      await database.insert(messagingGroupGrants).values([
        {
          channelId: groupId,
          actorId,
          role: 'member',
          generation: 1,
          grantedAt: timestamp,
        },
        {
          channelId: groupId,
          actorId: otherActorId,
          role: 'manager',
          generation: 1,
          grantedAt: timestamp,
        },
      ]);
      await database.insert(messagingGroupInvitations).values([
        {
          channelId: groupId,
          inviteeActorId: actorId,
          invitedByActorId: otherActorId,
          generation: 1,
          state: 'accepted',
          invitedAt: timestamp,
          decidedAt: timestamp,
        },
        {
          channelId: groupId,
          inviteeActorId: otherActorId,
          invitedByActorId: actorId,
          generation: 1,
          state: 'declined',
          invitedAt: timestamp,
          decidedAt: timestamp,
        },
      ]);
      await database.insert(messagingSocialCommands).values([
        {
          actorId,
          requestId: createId(),
          kind: 'dm.request',
          digest: 'a'.repeat(64),
          resultChannelId: dmId,
          createdAt: timestamp,
        },
        {
          actorId,
          requestId: createId(),
          kind: 'group.invite',
          digest: null,
          resultChannelId: groupId,
          createdAt: timestamp,
        },
        {
          actorId: otherActorId,
          requestId: createId(),
          kind: 'dm.decide',
          digest: 'b'.repeat(64),
          resultChannelId: dmId,
          createdAt: timestamp,
        },
        {
          actorId: otherActorId,
          requestId: createId(),
          kind: 'group.create',
          digest: 'c'.repeat(64),
          resultChannelId: groupId,
          createdAt: timestamp,
        },
      ]);
      await database.insert(messagingReceipts).values({
        channelId: dmId,
        actorId,
        requestId: createId(),
        payloadDigest: null,
        messageId: null,
      });
      await database.insert(messagingMessages).values([
        {
          id: ownMessageId,
          channelId: dmId,
          authorActorId: actorId,
          sequence: 1,
          changeVersion: 1,
          text: 'Subject contribution',
          createdAt: timestamp,
        },
        {
          id: otherMessageId,
          channelId: dmId,
          authorActorId: otherActorId,
          sequence: 2,
          changeVersion: 2,
          text: 'Counterparty contribution',
          createdAt: timestamp,
        },
      ]);
      for (const [owner, messageId] of [
        [actorId, ownMessageId],
        [otherActorId, otherMessageId],
      ] as const) {
        await database.insert(messagingActorStates).values({
          channelId: dmId,
          actorId: owner,
          following: true,
          hidden: false,
          notificationLevel: 'all',
        });
        await database.insert(messagingReceipts).values({
          channelId: dmId,
          actorId: owner,
          requestId,
          payloadDigest: 'a'.repeat(64),
          messageId,
        });
        await database.insert(messagingReactions).values({
          channelId: dmId,
          actorId: owner,
          messageId: otherMessageId,
          reaction: 'yes',
        });
      }
      await client.unsafe(
        'insert into account_age(user_id,birth_month,recorded_at) values($1,$2,$3),($4,$5,$3)',
        [userId, '2000-01', now, otherId, '2001-02'],
      );
      await run({
        ...context,
        otherActorId,
        dmId,
        groupId,
        ownMessageId,
        otherMessageId,
      });
    } finally {
      await client.unsafe('delete from privacy_jobs where subject_ref=$1', [
        userId,
      ]);
      await client.unsafe('delete from account_age where user_id in ($1,$2)', [
        userId,
        otherId,
      ]);
      await client.unsafe('delete from outbox where topic in ($1,$2)', [
        `channel:${dmId}`,
        `channel:${groupId}`,
      ]);
      // Missing migration must fail setup, while cleanup still releases older fixtures.
      const socialTable = await client.unsafe(
        "select to_regclass('public.messaging_social_commands') is not null as present",
      );
      if (socialTable[0]?.present)
        await client.unsafe(
          'delete from messaging_social_commands where actor_id in ($1,$2)',
          [actorId, otherActorId],
        );
      await client.unsafe(
        'delete from messaging_dm_pairs where low_actor_id=$1 or high_actor_id=$1',
        [actorId],
      );
      await client.unsafe(
        'delete from messaging_contact_pairs where low_actor_id=$1 or high_actor_id=$1',
        [actorId],
      );
      // Channel FK cascades delete only these fixtures' associations/content.
      await database
        .delete(messagingChannels)
        .where(eq(messagingChannels.id, dmId));
      await database
        .delete(messagingChannels)
        .where(eq(messagingChannels.id, groupId));
      await database.delete(actors).where(eq(actors.id, otherActorId));
    }
  });
}
