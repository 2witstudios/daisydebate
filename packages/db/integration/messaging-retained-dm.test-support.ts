import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { createMessagingTestFixture } from '../src/testing';
import { lockAuthorizationActors } from '../src/authorization';
import { createMessagingPrivacyAdopter } from '../src/messaging';
import { retainedConversationOperations } from '../src/messaging/retained-store';

const now = '2026-10-27T12:00:00.000Z';

/**
 * A DM between `subject` and `survivor`: the subject's message, the
 * survivor's reply to it and a removed message of theirs, the survivor's
 * reaction on the subject's message with its receipt, and both read
 * cursors.
 */
export const openDm = async (databaseUrl: string) => {
  const client = new SQL(databaseUrl);
  const database = drizzle({ client });
  const fixture = await createMessagingTestFixture(client);
  const { channelId } = fixture;
  const subject = { userId: fixture.userId!, actorId: fixture.actorId! };
  const survivor = {
    userId: fixture.otherUserId!,
    actorId: fixture.otherActorId!,
  };
  const ids = {
    theirs: createId(),
    reply: createId(),
    removed: createId(),
    replyRequest: createId(),
  };
  // One reserved upload each, so erasure's file outcome is part of residue.
  const files = {
    subject: { id: createId(), objectKey: createId() },
    survivor: { id: createId(), objectKey: createId() },
  };
  await client.unsafe(
    'update messaging_channels set message_sequence=3,change_version=3 where id=$1',
    [channelId],
  );
  await client.unsafe(
    "insert into messaging_messages(id,channel_id,author_actor_id,sequence,change_version,text,created_at) values($1,$3,$4,1,1,'Subject text',$6),($2,$3,$5,2,2,'Survivor reply',$6)",
    [ids.theirs, ids.reply, channelId, subject.actorId, survivor.actorId, now],
  );
  await client.unsafe(
    'insert into messaging_messages(id,channel_id,author_actor_id,sequence,change_version,text,created_at,removed_at) values($1,$2,$3,3,3,null,$4,$4)',
    [ids.removed, channelId, survivor.actorId, now],
  );
  await client.unsafe(
    'update messaging_messages set reply_to_message_id=$1 where id=$2',
    [ids.theirs, ids.reply],
  );
  await client.unsafe(
    "insert into messaging_reactions(channel_id,message_id,actor_id,reaction) values($1,$2,$3,'yes')",
    [channelId, ids.theirs, survivor.actorId],
  );
  await client.unsafe(
    'insert into messaging_receipts(channel_id,actor_id,request_id,payload_digest,message_id) values($1,$2,$3,$4,$5)',
    [channelId, survivor.actorId, createId(), 'a'.repeat(64), ids.theirs],
  );
  // Each author's own send receipt names their own message (FK to it).
  await client.unsafe(
    'insert into messaging_receipts(channel_id,actor_id,request_id,payload_digest,message_id) values($1,$2,$3,$4,$5),($1,$6,$7,$4,$8)',
    [
      channelId,
      subject.actorId,
      createId(),
      'b'.repeat(64),
      ids.theirs,
      survivor.actorId,
      ids.replyRequest,
      ids.reply,
    ],
  );
  await client.unsafe(
    "insert into messaging_actor_states(channel_id,actor_id,following,hidden,notification_level,read_sequence) values($1,$2,true,false,'all',1),($1,$3,true,false,'all',2)",
    [channelId, subject.actorId, survivor.actorId],
  );
  for (const [owner, file] of [
    [subject.actorId, files.subject],
    [survivor.actorId, files.survivor],
  ] as const)
    await client.unsafe(
      "insert into messaging_files(id,channel_id,owner_actor_id,request_id,object_key,filename,mime,reserved_bytes,generation,authority_revision,lifecycle,created_at,expires_at) values($1,$2,$3,$4,$5,'notes.pdf','application/pdf',20,1,1,'reserved',$6,$6::timestamptz + interval '1 hour')",
      [file.id, channelId, owner, createId(), file.objectKey, now],
    );
  const objectKeys = [files.subject.objectKey, files.survivor.objectKey];
  const erase = (who: typeof subject) =>
    database.transaction(async (tx) => {
      await lockAuthorizationActors(tx, [who.actorId], { maxActors: 1 });
      await createMessagingPrivacyAdopter().erase(tx, who, { now });
    });
  const close = async () => {
    await client.unsafe(
      'delete from messaging_file_deletion_intents where object_key in ($1,$2)',
      objectKeys,
    );
    await client.unsafe('delete from messaging_files where channel_id=$1', [
      channelId,
    ]);
    await client.unsafe("delete from outbox where payload->>'channelId'=$1", [
      channelId,
    ]);
    await client.unsafe('delete from messaging_channels where id=$1', [
      channelId,
    ]);
    await fixture.cleanup();
    await client.close();
  };
  const residue = async () =>
    (
      (await client.unsafe(
        `select
        (select count(*)::int from messaging_channels where id=$1) as channels,
        (select count(*)::int from messaging_messages where channel_id=$1) as messages,
        (select count(*)::int from messaging_retained_authors where channel_id=$1) as grants,
        (select count(*)::int from messaging_receipts where channel_id=$1) as receipts,
        (select count(*)::int from messaging_files where channel_id=$1) as files,
        (select count(*)::int from messaging_file_deletion_intents where object_key in ($2,$3)) as intents`,
        [channelId, ...objectKeys],
      )) as Record<string, number>[]
    )[0];
  return {
    client,
    database,
    channelId: channelId!,
    subject,
    survivor,
    ids,
    files,
    erase,
    close,
    residue,
    retained: retainedConversationOperations({ database }),
  };
};
