import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { openMessagingParticipants } from './messaging-fixture.test-support';
import {
  messagingFixturePosting,
  messagingFixtureReading,
} from './messaging-policy.test-support';
import { composeMessagingInbox } from '../src/features/messaging/inbox-composition';
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
      "update messaging_dm_pairs set request_state='pending', decided_at=null where channel_id=$1",
      [fixture.channelId],
    );
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
          entries: [{ channelId: fixture.channelId, kind: 'outgoing_request' }],
          nextAfter: null,
        },
        {
          entries: [{ channelId: fixture.channelId, kind: 'incoming_request' }],
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
    assert({
      given: 'current accepted authority',
      should:
        'replace request navigation with individually approved conversation navigation',
      actual: await inbox(recipient).read({ limit: 10 }),
      expected: {
        entries: [{ channelId: fixture.channelId, kind: 'conversation' }],
        nextAfter: null,
      },
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
