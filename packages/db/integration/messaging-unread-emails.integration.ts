import { instantMs } from '@daisy/clock';
import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  messagingUnreadEmailOperations,
  oweUnreadMessageEmails,
} from '../src/messaging/unread-emails';
import { createMessagingTestFixture } from '../src/testing';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const start = instantMs('2026-11-01T12:00:00.000Z');
const minute = (n: number) => new Date(start + n * 60_000).toISOString();

test('a message owes the other member one unread email, which ends once they read it', async () => {
  const client = new SQL(databaseUrl);
  const fixture = await createMessagingTestFixture(client);
  const database = drizzle({ client });
  const emails = messagingUnreadEmailOperations({ database });
  const { actorId, otherActorId, otherUserId, channelId } = fixture;
  try {
    await client.unsafe(
      "update users set email=id||'@daisy.test' where id in ($1,$2)",
      [fixture.userId, otherUserId],
    );
    const send = async (sequence: number, at: string) => {
      await client.unsafe(
        "insert into messaging_messages(id,channel_id,author_actor_id,sequence,change_version,text,created_at) values($1,$2,$3,$4,$4,'Hello',$5)",
        [createId(), channelId, actorId, sequence, at],
      );
      await database.transaction((tx) =>
        oweUnreadMessageEmails(tx, {
          channelId: channelId!,
          authorActorId: actorId!,
          at,
        }),
      );
    };
    const jobs = async () =>
      (await client.unsafe(
        `select id,user_id as "userId",to_char(next_attempt_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as due
          from messaging_unread_emails where user_id in ($1,$2)`,
        [fixture.userId, otherUserId],
      )) as { id: string; userId: string; due: string }[];
    await send(1, minute(0));
    await send(2, minute(10));
    const owed = await jobs();
    const unread = await emails.readMessagingUnreadEmailDelivery(owed[0]!.id);
    await client.unsafe(
      "insert into messaging_actor_states(channel_id,actor_id,following,hidden,notification_level,read_sequence) values($1,$2,false,false,'all',2)",
      [channelId, otherActorId],
    );
    const read = await emails.readMessagingUnreadEmailDelivery(owed[0]!.id);
    assert({
      given:
        'two messages ten minutes apart, then the other member reading both',
      should:
        'owe only the other member one email, due 30 minutes after the second, counting one conversation, then nothing',
      actual: {
        owed: owed.map(({ userId, due }) => [userId, due]),
        unread:
          unread.kind === 'send'
            ? [unread.conversations, unread.to]
            : unread.errorCode,
        read,
      },
      expected: {
        owed: [[otherUserId, minute(40)]],
        unread: [1, `${otherUserId}@daisy.test`],
        read: { kind: 'cancel', errorCode: 'not-owed' },
      },
    });
    await client.unsafe(
      'delete from messaging_unread_emails where user_id=$1',
      [otherUserId],
    );
    await client.unsafe(
      "update messaging_actor_states set notification_level='none' where channel_id=$1 and actor_id=$2",
      [channelId, otherActorId],
    );
    await send(3, minute(60));
    assert({
      given: 'the other member choosing no notifications for the conversation',
      should: 'owe them no email for its next message',
      actual: (await jobs()).length,
      expected: 0,
    });
  } finally {
    await client.unsafe(
      'delete from messaging_unread_emails where user_id in ($1,$2)',
      [fixture.userId, otherUserId],
    );
    await fixture.cleanup();
    await client.close();
  }
});
