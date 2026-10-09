import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { expect } from 'bun:test';
import { accountAgePrivacyAdopter } from '../src/account-age';
import { createMessagingPrivacyAdopter } from '../src/messaging/privacy';
import {
  erasePrivacySubject,
  exportPrivacySubject,
  messagingPrivacyExpectedColumns,
  type PrivacyAdopter,
  type PrivacyExport,
} from '../src/privacy';
import { bindings, now } from './privacy.test-support';
import { withPrivacyMessaging } from './privacy-messaging.test-support';

setupRitewayBun();
requireTestServices(process.env);
const requiredAdopters = [
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
function assertSocialExport(
  result: PrivacyExport,
  peer: PrivacyExport,
  actorId: string,
) {
  assert({
    given: 'DM sender introduction and subject social command rows',
    should: 'exclude counterpart introduction and commands',
    actual: [
      result.messaging_dm_pairs?.[0]?.introduction,
      Object.hasOwn(peer.messaging_dm_pairs?.[0] ?? {}, 'introduction'),
      result.messaging_social_commands?.every(
        (row) => row.actor_id === actorId,
      ),
      result.messaging_social_commands?.length,
    ],
    expected: ['Subject introduction', false, true, 2],
  });
  assertInvitationExport(result.messaging_group_invitations ?? [], actorId);
}
function assertInvitationExport(rows: PrivacyExport[string], actorId: string) {
  const invited = rows.find((row) => row.invitee_actor_id === actorId);
  const invitation = rows.find((row) => row.invited_by_actor_id === actorId);
  assert({
    given: 'both invitation directions',
    should: 'export decision state only to its recipient',
    actual: [
      invited?.state,
      Object.hasOwn(invitation ?? {}, 'state'),
      Object.hasOwn(invitation ?? {}, 'decided_at'),
    ],
    expected: ['accepted', false, false],
  });
}

test('canonical privacy export composes MSG and age while masking other private data', async () => {
  await withPrivacyMessaging(
    async ({ database, userId, actorId, otherId, otherActorId }) => {
      const result = await exportPrivacySubject(
        database,
        { userId, actorId },
        {
          requiredAdopters,
          adopters: [createMessagingPrivacyAdopter(), accountAgePrivacyAdopter],
        },
      );
      const peer = await exportPrivacySubject(
        database,
        { userId: otherId, actorId: otherActorId },
        {
          requiredAdopters,
          adopters: [createMessagingPrivacyAdopter(), accountAgePrivacyAdopter],
        },
      );
      assertSocialExport(result, peer, actorId);
      const contact = result.messaging_contact_pairs?.[0] ?? {};
      assert({
        given:
          'real shared channels, counterpart blocks, other messages and birthmonths',
        should:
          'export only the subject contribution, own block direction and own age, with no unowned title',
        actual: [
          result.messaging_messages?.map((row) => row.text),
          Object.values(contact).includes(true),
          result.messaging_channels,
          result.account_age?.map((row) => row.birth_month),
        ],
        expected: [['Subject contribution'], false, [], ['2000-01']],
      });
    },
  );
});

test('canonical composed erasure rolls back all adopters then commits subject-only cleanup and intents', async () => {
  await withPrivacyMessaging(
    async ({
      client,
      database,
      userId,
      actorId,
      otherId,
      otherActorId,
      dmId,
      groupId,
      ownMessageId,
      otherMessageId,
    }) => {
      const adopters = [
        createMessagingPrivacyAdopter(),
        accountAgePrivacyAdopter,
      ];
      const late: PrivacyAdopter = {
        id: 'rollback-probe',
        phase: 'after-scrub',
        fields: [],
        export: async () => ({}),
        erase: async () => {
          throw new Error('composed rollback');
        },
      };
      const input = {
        subject: { userId, actorId },
        now,
        vendors: ['posthog'],
        jobIds: [createId()],
      };
      await expect(
        erasePrivacySubject(
          database,
          input,
          {
            requiredAdopters: [
              ...requiredAdopters,
              { id: late.id, phase: late.phase, expectedColumns: {} },
            ],
            adopters: [...adopters, late],
          },
          bindings,
        ),
      ).rejects.toThrow('composed rollback');
      const rolledBack = await client.unsafe(
        'select text from messaging_messages where id=$1',
        [ownMessageId],
      );
      const ageAfterRollback = await client.unsafe(
        'select count(*)::int as n from account_age where user_id=$1',
        [userId],
      );
      const doorsAfterRollback = await client.unsafe(
        'select count(*)::int as n from outbox where topic in ($1,$2)',
        [`channel:${dmId}`, `channel:${groupId}`],
      );
      const restoredSocial = await client.unsafe(
        'select (select count(*) from messaging_social_commands where actor_id in ($1,$2))::int as commands,(select count(*) from messaging_group_invitations where channel_id=$3)::int as invitations',
        [actorId, otherActorId, groupId],
      );
      assert({
        given: 'late failure after social command and invitation cleanup',
        should: 'restore all social lifecycle rows in the same rollback',
        actual: restoredSocial[0],
        expected: { commands: 4, invitations: 2 },
      });
      assert({
        given:
          'a failure after MSG cleanup, auth scrub and account-age removal',
        should: 'restore content/age and discard transactional doorbells',
        actual: [
          rolledBack[0]?.text,
          ageAfterRollback[0]?.n,
          doorsAfterRollback[0]?.n,
        ],
        expected: ['Subject contribution', 1, 0],
      });
      await erasePrivacySubject(
        database,
        input,
        { requiredAdopters, adopters },
        bindings,
      );
      const survivingSocial = await client.unsafe(
        'select actor_id,kind,result_channel_id from messaging_social_commands where actor_id in ($1,$2)',
        [actorId, otherActorId],
      );
      const survivingInvitations = await client.unsafe(
        'select count(*)::int as n from messaging_group_invitations where channel_id=$1',
        [groupId],
      );
      assert({
        given:
          'subject-owned commands, both invitation directions and peer DM/group results',
        should:
          'delete subject and erased-DM associations while preserving peer group commands',
        actual: [[...survivingSocial], survivingInvitations[0]?.n],
        expected: [
          [
            {
              actor_id: otherActorId,
              kind: 'group.create',
              result_channel_id: groupId,
            },
          ],
          0,
        ],
      });
      const contents = await client.unsafe(
        'select id,text,removed_at is not null as removed from messaging_messages where id in ($1,$2) order by sequence',
        [ownMessageId, otherMessageId],
      );
      const ownCounts = await Promise.all(
        [
          'messaging_receipts',
          'messaging_reactions',
          'messaging_actor_states',
          'messaging_group_grants',
        ].map((table) =>
          client.unsafe(
            `select count(*)::int as n from ${table} where actor_id=$1`,
            [actorId],
          ),
        ),
      );
      const associations = await client.unsafe(
        'select (select count(*) from messaging_contact_pairs where low_actor_id=$1 or high_actor_id=$1)::int as contacts,(select count(*) from messaging_dm_pairs where low_actor_id=$1 or high_actor_id=$1)::int as pairs',
        [actorId],
      );
      const remainingAge = await client.unsafe(
        'select user_id,birth_month from account_age where user_id in ($1,$2)',
        [userId, otherId],
      );
      const title = await client.unsafe(
        'select title from messaging_channels where id=$1',
        [groupId],
      );
      const job = await client.unsafe(
        'select vendor,status from privacy_jobs where subject_ref=$1',
        [userId],
      );
      const doors = await client.unsafe(
        'select payload from outbox where topic in ($1,$2)',
        [`channel:${dmId}`, `channel:${groupId}`],
      );
      assert({
        given:
          'successful same-tx MSG+age adoption and configured vendor intent',
        should:
          'scrub subject text, remove private associations, preserve other text/title/age and publish only content-free doorbells',
        actual: [
          [...contents],
          ownCounts.map((rows) => rows[0]?.n),
          associations[0],
          [...remainingAge],
          title[0]?.title,
          [...job],
          doors.length,
          doors.every(
            (row: { payload: Record<string, unknown> }) =>
              Object.keys(row.payload).sort().join(',') ===
              'changeVersion,channelId,kind',
          ),
        ],
        expected: [
          [
            { id: ownMessageId, text: null, removed: true },
            {
              id: otherMessageId,
              text: 'Counterparty contribution',
              removed: false,
            },
          ],
          [0, 0, 0, 0],
          { contacts: 0, pairs: 0 },
          [{ user_id: otherId, birth_month: '2001-02' }],
          'Unattributed shared title',
          [{ vendor: 'posthog', status: 'pending' }],
          2,
          true,
        ],
      });
    },
  );
});
