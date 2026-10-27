import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { openMessagingParticipants } from './messaging-fixture.test-support';
import {
  messagingFixturePosting,
  messagingFixtureReading,
} from './messaging-policy.test-support';
import { composeMessagingInbox } from '../src/features/messaging/inbox-composition';
import { createId } from '@paralleldrive/cuid2';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('real own collection projects pending direction through fresh request grants and forgets erased pair associations', async () => {
  const { client, database, fixture, sender, recipient } =
    await openMessagingParticipants(databaseUrl);
  const inbox = (principal: typeof sender) =>
    composeMessagingInbox({
      database,
      principal,
      clock: { now: () => fixture.now },
      postingPolicy: messagingFixturePosting,
      readingPolicy: messagingFixtureReading,
    });
  try {
    await client.unsafe(
      "update messaging_dm_pairs set request_state='pending', decided_at=null, request_sender_actor_id=$2, introduction=$3 where channel_id=$1",
      [fixture.channelId, sender.actorId, 'Practice   policy\ntonight?'],
    );
    const request = {
      channelId: fixture.channelId,
      activityAt: fixture.now,
    };
    assert({
      given:
        'a real pending pair and separately approved test reading evidence',
      should: 'project only sender status and recipient request navigation',
      actual: [
        await inbox(sender).read({ limit: 10 }),
        await inbox(recipient).read({ limit: 10 }),
        await inbox(sender).status(fixture.channelId),
      ],
      expected: [
        {
          entries: [
            {
              ...request,
              kind: 'outgoing_request',
              title: fixture.otherUserId,
              preview: { text: 'Practice policy tonight?', fromSelf: true },
              unread: false,
            },
          ],
          nextAfter: null,
        },
        {
          entries: [
            {
              ...request,
              kind: 'incoming_request',
              title: fixture.userId,
              preview: { text: 'Practice policy tonight?', fromSelf: false },
              unread: true,
            },
          ],
          nextAfter: null,
        },
        { channelId: fixture.channelId, state: 'pending' },
      ],
    });
    await assertRejects({
      given: 'the recipient attempting the sender-only status grant',
      should: 'refuse despite collection association',
      code: 'NOT_FOUND',
      actual: () => inbox(recipient).status(fixture.channelId),
    });
    await client.unsafe(
      "update messaging_dm_pairs set request_state='accepted', decided_at=$2 where channel_id=$1",
      [fixture.channelId, fixture.now],
    );
    const sentAt = '2026-10-09T17:55:00.000Z';
    await client.unsafe(
      "insert into messaging_messages(id,channel_id,author_actor_id,sequence,change_version,text,created_at) values($1,$2,$3,1,1,'First message',$4)",
      [createId(), fixture.channelId, sender.actorId, sentAt],
    );
    await client.unsafe(
      'insert into messaging_messages(id,channel_id,author_actor_id,sequence,change_version,text,created_at,removed_at) values($1,$2,$3,2,2,null,$4,$4)',
      [createId(), fixture.channelId, sender.actorId, sentAt],
    );
    await client.unsafe(
      'update messaging_channels set message_sequence=2, change_version=2 where id=$1',
      [fixture.channelId],
    );
    const conversation = {
      channelId: fixture.channelId,
      kind: 'conversation',
      activityAt: sentAt,
    };
    assert({
      given: 'current accepted authority with an unread message',
      should:
        'replace request navigation with the newest surviving message, never the introduction',
      actual: [
        await inbox(recipient).read({ limit: 10 }),
        await inbox(sender).read({ limit: 10 }),
      ],
      expected: [
        {
          entries: [
            {
              ...conversation,
              title: fixture.userId,
              preview: { text: 'First message', fromSelf: false },
              unread: true,
            },
          ],
          nextAfter: null,
        },
        {
          entries: [
            {
              ...conversation,
              title: fixture.otherUserId,
              preview: { text: 'First message', fromSelf: true },
              unread: false,
            },
          ],
          nextAfter: null,
        },
      ],
    });
    await client.unsafe(
      "insert into messaging_actor_states(channel_id,actor_id,following,hidden,notification_level,read_sequence) values($1,$2,false,false,'none',1)",
      [fixture.channelId, recipient.actorId],
    );
    const read = await inbox(recipient).read({ limit: 10 });
    assert({
      given: 'the recipient read through the newest surviving message',
      should: 'clear the unread state',
      actual: read.entries.map((entry) => 'unread' in entry && entry.unread),
      expected: [false],
    });
    await fixture.eraseSubject(sender.actorId);
    assert({
      given: 'erasure removed the personal pair association',
      should:
        'return no surviving collection candidate without recreating authority',
      actual: await inbox(recipient).read({ limit: 10 }),
      expected: { entries: [], nextAfter: null },
    });
  } finally {
    await fixture.cleanup();
    await database.close();
    await client.close();
  }
});
