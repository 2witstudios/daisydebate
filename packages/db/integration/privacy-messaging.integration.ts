import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { expect } from 'bun:test';
import { runPrivacyErasure, runPrivacyExport } from '../src/privacy/operations';
import type { PrivacyAdopter, PrivacyExport } from '../src/privacy/contracts';
import { bindings, now } from './privacy.test-support';
import {
  messagingPrivacyAdoption,
  withPrivacyMessaging,
} from './privacy-messaging.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('a subject with no messaging files still has an empty export collection', async () => {
  await withPrivacyMessaging(async ({ database, userId, actorId }) => {
    const result = await runPrivacyExport(
      database,
      { userId, actorId },
      messagingPrivacyAdoption,
    );
    assert({
      given: 'an account without stored messaging files',
      should: 'return the empty collection',
      actual: result.messaging_files,
      expected: [],
    });
  });
});
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
      const result = await runPrivacyExport(
        database,
        { userId, actorId },
        messagingPrivacyAdoption,
      );
      const peer = await runPrivacyExport(
        database,
        { userId: otherId, actorId: otherActorId },
        messagingPrivacyAdoption,
      );
      assertSocialExport(result, peer, actorId);
      const contact = result.contact_pairs?.[0] ?? {};
      assert({
        given:
          'real shared channels, counterpart blocks, other messages and birthmonths',
        should:
          'export only the subject contribution, own block direction and own age, with no unowned title',
        actual: [
          result.messaging_messages?.map((row) => [row.text, row.created_at]),
          Object.values(contact).includes(true),
          result.messaging_channels,
          result.account_age?.map((row) => row.birth_month),
        ],
        expected: [[['Subject contribution', now]], false, [], ['2000-01']],
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
      const adopters = messagingPrivacyAdoption;
      const late: PrivacyAdopter = {
        id: 'rollback-probe',
        phase: 'after-close',
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
        runPrivacyErasure(database, input, [...adopters, late], bindings),
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
      await runPrivacyErasure(database, input, adopters, bindings);
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
        'select (select count(*) from contact_pairs where low_actor_id=$1 or high_actor_id=$1)::int as contacts,(select count(*) from messaging_dm_pairs where low_actor_id=$1 or high_actor_id=$1)::int as pairs',
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
          'delete the subject DM message (ADR 0086), remove private associations, preserve other text/title/age and write no channel doorbell (ADR 0089)',
        actual: [
          [...contents],
          ownCounts.map((rows) => rows[0]?.n),
          associations[0],
          [...remainingAge],
          title[0]?.title,
          [...job],
          doors.length,
        ],
        expected: [
          [
            {
              id: otherMessageId,
              text: 'Counterparty contribution',
              removed: false,
            },
          ],
          [0, 0, 0, 0],
          { contacts: 0, pairs: 0 },
          [{ user_id: otherId, birth_month: '2001-02' }],
          'Peer-authored shared title',
          [{ vendor: 'posthog', status: 'pending' }],
          0,
        ],
      });
    },
  );
});

test('Contacts and Friends export only their subject rows and erase after Messaging', async () => {
  await withPrivacyMessaging(
    async ({ client, database, userId, actorId, otherId, otherActorId }) => {
      const [low, high] =
        actorId < otherActorId
          ? [actorId, otherActorId]
          : [otherActorId, actorId];
      const subject = { userId, actorId };
      const peer = { userId: otherId, actorId: otherActorId };
      const ownRequest = createId();
      const peerRequest = createId();
      const until = '2026-10-10T18:00:00.000Z';
      try {
        await client`insert into friendships(low_actor_id,high_actor_id,requester_actor_id,state,requested_at,accepted_at)
          values(${low},${high},${actorId},'accepted',${now},${now})`;
        for (const [self, other, request] of [
          [actorId, otherActorId, ownRequest],
          [otherActorId, actorId, peerRequest],
        ] as const) {
          await client`insert into social_requests(actor_id,request_id,counterpart_actor_id,kind,unrelated,created_at)
            values(${self},${request},${other},'friend',true,${now})`;
          await client`insert into social_request_declines(decliner_actor_id,requester_actor_id,low_actor_id,high_actor_id,declined_count,last_declined_at,expires_at)
            values(${self},${other},${low},${high},1,${now},${until})`;
          await client`insert into contact_commands(actor_id,request_id,counterpart_actor_id,kind,digest,created_at)
            values(${self},${request},${other},'contact.block',${'a'.repeat(64)},${now})`;
        }
        const own = await runPrivacyExport(
          database,
          subject,
          messagingPrivacyAdoption,
        );
        const other = await runPrivacyExport(
          database,
          peer,
          messagingPrivacyAdoption,
        );
        assert({
          given: 'both directions of the pair and an accepted friendship',
          should:
            'export only each subjects own requests, declines, receipts, and block direction',
          actual: [own, other].map((result) => ({
            direction: Object.keys(result.contact_pairs?.[0] ?? {}).filter(
              (key) => key.includes('blocks'),
            ),
            requests: result.social_requests?.map(
              ({ request_id, created_at }) => [request_id, created_at],
            ),
            decline: result.social_request_declines?.map(
              ({ decliner_actor_id }) => decliner_actor_id,
            ),
            receipts: result.contact_commands?.map(
              ({ request_id }) => request_id,
            ),
            friendships: result.friendships?.map(({ state, accepted_at }) => [
              state,
              accepted_at,
            ]),
          })),
          expected: [
            {
              direction: [
                actorId === low ? 'low_blocks_high' : 'high_blocks_low',
              ],
              requests: [[ownRequest, now]],
              decline: [actorId],
              receipts: [ownRequest],
              friendships: [['accepted', now]],
            },
            {
              direction: [
                otherActorId === low ? 'low_blocks_high' : 'high_blocks_low',
              ],
              requests: [[peerRequest, now]],
              decline: [otherActorId],
              receipts: [peerRequest],
              friendships: [['accepted', now]],
            },
          ],
        });
        await runPrivacyErasure(
          database,
          { subject, now, vendors: [], jobIds: [] },
          messagingPrivacyAdoption,
          bindings,
        );
        const [left] = await client`select
          (select count(*)::int from friendships where low_actor_id=${low} and high_actor_id=${high}) as friendships,
          (select count(*)::int from contact_pairs where low_actor_id=${low} and high_actor_id=${high}) as pairs,
          (select count(*)::int from social_requests where request_id in (${ownRequest},${peerRequest})) as requests,
          (select count(*)::int from social_request_declines where low_actor_id=${low} and high_actor_id=${high}) as declines,
          (select count(*)::int from contact_commands where request_id in (${ownRequest},${peerRequest})) as receipts`;
        assert({
          given:
            'the canonical erasure composed over Messaging, Friends and Contacts',
          should:
            'erase every association naming the subject without a foreign key failure',
          actual: left,
          expected: {
            friendships: 0,
            pairs: 0,
            requests: 0,
            declines: 0,
            receipts: 0,
          },
        });
      } finally {
        await client`delete from friendships where low_actor_id=${low} and high_actor_id=${high}`;
        await client`delete from social_request_declines where low_actor_id=${low} and high_actor_id=${high}`;
      }
    },
  );
});
