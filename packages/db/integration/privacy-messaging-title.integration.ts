import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { expect } from 'bun:test';
import {
  erasePrivacySubject,
  exportPrivacySubject,
  type PrivacyAdopter,
} from '../src/privacy';
import { rejectedBy } from './constraint-helpers';
import { bindings, now } from './privacy.test-support';
import {
  messagingRequiredAdopters as requiredAdopters,
  messagingPrivacyAdoption,
  withPrivacyMessaging,
} from './privacy-messaging.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('canonical title erasure retains peer manager data and rolls back all local effects on late failure', async () => {
  await withPrivacyMessaging(
    async ({
      client,
      database,
      userId,
      actorId,
      otherId,
      otherActorId,
      groupId,
      dmId: contextDmId,
    }) => {
      const authoredId = createId();
      try {
        await client.unsafe(
          "insert into messaging_channels(id,kind,policy_key,policy_revision,lifecycle,title,title_author_actor_id) values($1,'private_group','social.private_group',1,'active','Subject title',$2)",
          [authoredId, actorId],
        );
        await client.unsafe(
          "insert into messaging_group_grants(channel_id,actor_id,role,generation,granted_at) values($1,$2,'manager',1,$3)",
          [authoredId, otherActorId, now],
        );
        for (const [statement, values, constraint] of [
          [
            'update messaging_channels set title_author_actor_id=null where id=$1',
            [authoredId],
            'messaging_channels_title',
          ],
          [
            'update messaging_channels set title=null where id=$1',
            [authoredId],
            'messaging_channels_title',
          ],
          [
            "update messaging_channels set title='Invalid DM title',title_author_actor_id=$2 where id=$1",
            [contextDmId, actorId],
            'messaging_channels_title',
          ],
          [
            'update messaging_channels set title_author_actor_id=$2 where id=$1',
            [authoredId, createId()],
            'messaging_channels_title_author_actor_id_actors_id_fkey',
          ],
        ] as const) {
          assert({
            given: 'invalid title authorship persisted directly',
            should: 'refuse the precise relational constraint',
            actual: await rejectedBy(
              async () => await client.unsafe(statement, [...values]),
            ),
            expected: constraint,
          });
        }
        const adoption = {
          requiredAdopters,
          adopters: messagingPrivacyAdoption.adopters,
        };
        const subject = { userId, actorId };
        const exported = await exportPrivacySubject(
          database,
          subject,
          adoption,
        );
        const peer = await exportPrivacySubject(
          database,
          { userId: otherId, actorId: otherActorId },
          adoption,
        );
        assert({
          given:
            'author has no current grant or command association and peer manages both channels',
          should: 'export each title only to its durable author',
          actual: [exported.messaging_channels, peer.messaging_channels],
          expected: [
            [
              {
                id: authoredId,
                title: 'Subject title',
                title_author_actor_id: actorId,
              },
            ],
            [
              {
                id: groupId,
                title: 'Peer-authored shared title',
                title_author_actor_id: otherActorId,
              },
            ],
          ],
        });
        const snapshot = async () => {
          const channels = await client.unsafe(
            'select id,title,title_author_actor_id,change_version::int,lifecycle from messaging_channels where id in ($1,$2) order by id',
            [authoredId, groupId],
          );
          const local = await client.unsafe(
            'select (select count(*) from messaging_group_grants where channel_id in ($1,$2))::int as grants,(select count(*) from messaging_social_commands where actor_id in ($3,$4))::int as receipts,(select count(*) from outbox where topic in ($5,$6))::int as bells,(select deleted_at from users where id=$7) as erased',
            [
              authoredId,
              groupId,
              actorId,
              otherActorId,
              `channel:${authoredId}`,
              `channel:${groupId}`,
              userId,
            ],
          );
          return [[...channels], [...local]];
        };
        const before = await snapshot();
        const late: PrivacyAdopter = {
          id: 'title-rollback-probe',
          phase: 'after-scrub',
          fields: [],
          export: async () => ({}),
          erase: async () => {
            throw new Error('title rollback');
          },
        };
        const input = { subject, now, vendors: [], jobIds: [] };
        await expect(
          erasePrivacySubject(
            database,
            input,
            {
              requiredAdopters: [
                ...requiredAdopters,
                { id: late.id, phase: late.phase, expectedColumns: {} },
              ],
              adopters: [...adoption.adopters, late],
            },
            bindings,
          ),
        ).rejects.toThrow('title rollback');
        assert({
          given:
            'late canonical erasure failure after title clearing and auth scrub',
          should:
            'restore titles, authors, grants, receipts, versions and doorbells atomically',
          actual: await snapshot(),
          expected: before,
        });
        await erasePrivacySubject(database, input, adoption, bindings);
        const [owned] = await client.unsafe(
          'select title,title_author_actor_id,change_version::int as version,lifecycle from messaging_channels where id=$1',
          [authoredId],
        );
        const grants = await client.unsafe(
          'select actor_id,role from messaging_group_grants where channel_id=$1',
          [authoredId],
        );
        const [foreign] = await client.unsafe(
          'select title,title_author_actor_id from messaging_channels where id=$1',
          [groupId],
        );
        const bells = await client.unsafe(
          'select payload from outbox where topic=$1',
          [`channel:${authoredId}`],
        );
        assert({
          given:
            'successful subject erasure with only a surviving peer manager grant',
          should:
            'delete own title and binding, preserve peer title and authority, and emit one content-free final version',
          actual: [
            owned,
            [...grants],
            foreign,
            [...bells].map((row) => row.payload),
          ],
          expected: [
            {
              title: null,
              title_author_actor_id: null,
              version: 1,
              lifecycle: 'active',
            },
            [{ actor_id: otherActorId, role: 'manager' }],
            {
              title: 'Peer-authored shared title',
              title_author_actor_id: otherActorId,
            },
            [
              {
                kind: 'channel.changed',
                channelId: authoredId,
                changeVersion: 1,
              },
            ],
          ],
        });
      } finally {
        await client.unsafe('delete from outbox where topic=$1', [
          `channel:${authoredId}`,
        ]);
        await client.unsafe('delete from messaging_channels where id=$1', [
          authoredId,
        ]);
      }
    },
  );
});
