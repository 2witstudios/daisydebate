import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { readObservationHeaders } from '../src/observation-headers';
import { withFixture } from './constraint-helpers';
import { createAuthorizationSubject } from './authorization.test-support';
import { validConfig, validRules } from './round-fixtures';
import { createMessagingTestFixture } from '../src/messaging/test-fixture';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
test('Room content/readiness and same-actor seat moves preserve disclosure/purge', async () => {
  await withFixture(url, async (f) => {
    const subject = await createAuthorizationSubject(f),
      id = createId(),
      seat = createId();
    await f.insert('rooms', {
      id,
      host_actor_id: subject.actorId,
      title: 'Header classification',
      topic: 'Topic',
      visibility: 'private',
      format_id: await f.format(),
      format_version: 1,
      competition_type: 'casual',
      length: 'full',
      config: validConfig,
      execution_plan: {},
      rules_snapshot: validRules,
      status: 'assembling',
    });
    await f.insert('room_participants', {
      id: seat,
      room_id: id,
      actor_id: subject.actorId,
      role: 'affirmative',
      slot: 0,
    });
    const read = async () =>
      (
        await readObservationHeaders(drizzle({ client: f.sql }), [
          { kind: 'room', id },
        ])
      )[0]!;
    const initial = await read();
    await f.sql.begin(async (tx) => {
      await tx`update rooms set status='ready',title='Updated content',version=version+1 where id=${id}`;
      await tx`update room_participants set readiness_version=readiness_version+1,readiness_command_id=${createId()},role='negative' where id=${seat}`;
    });
    const content = await read();
    await f.sql`delete from room_participants where id=${seat}`;
    const removed = await read();
    assert({
      given: 'content/readiness followed by genuine membership removal',
      should:
        'preserve audience identity through content and fence actual removal',
      actual: [
        content.contentRevision > initial.contentRevision,
        content.disclosureRevision - initial.disclosureRevision,
        content.purgeGeneration - initial.purgeGeneration,
        removed.disclosureRevision - content.disclosureRevision,
        removed.purgeGeneration - content.purgeGeneration,
      ],
      expected: [true, 0, 0, 1, 1],
    });
  });
});
test('message changes perform zero recipient inbox work and removal retains channel purge', async () => {
  await withFixture(url, async (f) => {
    const fixture = await createMessagingTestFixture(f.sql);
    const resources = [fixture.actorId, fixture.otherActorId].map((id) => ({
      kind: 'inbox' as const,
      id,
    }));
    const read = () =>
      readObservationHeaders(drizzle({ client: f.sql }), resources);
    try {
      const before = await read(),
        messageId = createId();
      const [channelBefore] = await readObservationHeaders(
        drizzle({ client: f.sql }),
        [{ kind: 'channel', id: fixture.channelId }],
      );
      let inboxPending = -1;
      await f.sql.begin(async (tx) => {
        await tx`insert into messaging_messages(id,channel_id,author_actor_id,sequence,change_version,text,created_at) values(${messageId},${fixture.channelId},${fixture.actorId},1,1,'Content',clock_timestamp())`;
        [{ count: inboxPending }] =
          await tx`select count(*)::int count from resource_observation_pending where transaction_id=pg_current_xact_id() and kind='inbox'`;
      });
      await f.sql`update messaging_messages set text=null,removed_at=clock_timestamp(),change_version=2 where id=${messageId}`;
      const after = await read();
      const [channelAfter] = await readObservationHeaders(
        drizzle({ client: f.sql }),
        [{ kind: 'channel', id: fixture.channelId }],
      );
      assert({
        given: 'send and removal with actual DM recipients',
        should:
          'do zero recipient collection work and preserve channel erasure fence',
        actual: {
          inboxPending,
          inbox: after,
          purge: channelAfter!.purgeGeneration - channelBefore!.purgeGeneration,
        },
        expected: { inboxPending: 0, inbox: before, purge: 1 },
      });
    } finally {
      await fixture.cleanup();
    }
  });
});
