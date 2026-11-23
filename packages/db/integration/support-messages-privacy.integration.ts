import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { supportMessagePrivacyAdopter } from '../src/support-messages-privacy';
import { exportThenErase, withPrivacySubject } from './privacy.test-support';

setupRitewayBun();

const insertMessage = (
  client: { unsafe: (query: string, values: unknown[]) => Promise<unknown> },
  id: string,
  memberUserId: string | null,
) =>
  client.unsafe(
    `insert into support_messages (id,form_id,fields_digest,topic,message,reply_email,member_user_id,next_attempt_at)
     values ($1,$1,$2,'question','How do strikes work?','sam@example.test',$3,now())`,
    [id, 'a'.repeat(64), memberUserId],
  );

test('export carries a signed-in sender’s support messages, and erasure deletes them alone', async () => {
  await withPrivacySubject(async ({ client, database, userId, actorId }) => {
    const theirs = createId();
    const visitor = createId();
    try {
      await insertMessage(client, theirs, userId);
      await insertMessage(client, visitor, null);
      const exported = await exportThenErase(database, { userId, actorId }, [
        supportMessagePrivacyAdopter,
      ]);
      const left = (await client.unsafe(
        'select id from support_messages where id in ($1, $2) order by id',
        [theirs, visitor],
      )) as { id: string }[];
      assert({
        given: 'one message sent signed in by the subject and one by a visitor',
        should:
          'export the subject’s message, then delete it and keep the visitor’s',
        actual: {
          exported: exported.support_messages?.map((row) => [
            row.id,
            row.topic,
            row.reply_email,
          ]),
          left: left.map((row) => row.id),
        },
        expected: {
          exported: [[theirs, 'question', 'sam@example.test']],
          left: [visitor],
        },
      });
    } finally {
      await client.unsafe('delete from support_messages where id in ($1, $2)', [
        theirs,
        visitor,
      ]);
    }
  });
});
