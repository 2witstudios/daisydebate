import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingTestFixture } from '../src/testing';
import { lockAuthorizationActors } from '../src/authorization';
import { createMessagingPrivacyAdopter } from '../src/messaging';
import { readMessagingChannelFact } from '../src/messaging/social';
import { retainedConversationOperations } from '../src/messaging/retained-store';
import {
  acknowledgeErasedFileDeletion,
  pendingFileDeletions,
} from '../src/messaging-files';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const now = '2026-10-27T12:00:00.000Z';
const unfenced = async () => {};

/**
 * A DM between `subject` and `survivor`: the subject's message, the
 * survivor's reply to it and a removed message of theirs, the survivor's
 * reaction on the subject's message with its receipt, and both read
 * cursors.
 */
const openDm = async () => {
  const client = new SQL(databaseUrl);
  const database = drizzle({ client });
  const fixture = await createMessagingTestFixture(client);
  const { channelId } = fixture;
  const subject = { userId: fixture.userId!, actorId: fixture.actorId! };
  const survivor = {
    userId: fixture.otherUserId!,
    actorId: fixture.otherActorId!,
  };
  const ids = { theirs: createId(), reply: createId(), removed: createId() };
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
      createId(),
      ids.reply,
    ],
  );
  await client.unsafe(
    "insert into messaging_actor_states(channel_id,actor_id,following,hidden,notification_level,read_sequence) values($1,$2,true,false,'all',1),($1,$3,true,false,'all',2)",
    [channelId, subject.actorId, survivor.actorId],
  );
  const erase = (who: typeof subject) =>
    database.transaction(async (tx) => {
      await lockAuthorizationActors(tx, [who.actorId], { maxActors: 1 });
      await createMessagingPrivacyAdopter().erase(tx, who, { now });
    });
  const close = async () => {
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
        (select count(*)::int from messaging_receipts where channel_id=$1) as receipts`,
        [channelId],
      )) as Record<string, number>[]
    )[0];
  return {
    client,
    database,
    channelId: channelId!,
    subject,
    survivor,
    ids,
    erase,
    close,
    residue,
    retained: retainedConversationOperations({ database }),
  };
};

test('erasing one DM member keeps only the survivor’s own rows, with nothing pointing at the subject (DEC-126, ISSUE-644)', async () => {
  const dm = await openDm();
  const { client, channelId, survivor, ids } = dm;
  try {
    await dm.erase(dm.subject);
    const messages = await client.unsafe(
      'select id,author_actor_id as author,reply_to_message_id as reply from messaging_messages where channel_id=$1 order by sequence',
      [channelId],
    );
    const [state] = (await client.unsafe(
      `select c.lifecycle,
        (select string_agg(actor_id, ',') from messaging_retained_authors r where r.channel_id=c.id) as survivors,
        (select count(*)::int from messaging_reactions where channel_id=c.id) as reactions,
        (select count(*)::int from messaging_actor_states where channel_id=c.id) as cursors,
        (select count(*)::int from messaging_receipts where channel_id=c.id and (actor_id=$2 or (message_id is distinct from $3 and (message_id is not null or payload_digest is not null)))) as pointing,
        (select count(*)::int from messaging_receipts where channel_id=c.id and actor_id=$4 and message_id=$3) as own
      from messaging_channels c where c.id=$1`,
      [channelId, dm.subject.actorId, ids.reply, survivor.actorId],
    )) as Record<string, unknown>[];
    assert({
      given: 'a committed erasure of the subject',
      should:
        'delete the subject’s rows with their receipts and the reactions on them, null the survivor’s reply pointer, reduce their receipt on the subject’s message to a consumed marker, keep their own send receipt, drop both cursors and retain the channel for the survivor alone',
      actual: [messages, state],
      expected: [
        [
          { id: ids.reply, author: survivor.actorId, reply: null },
          { id: ids.removed, author: survivor.actorId, reply: null },
        ],
        {
          lifecycle: 'retained',
          survivors: survivor.actorId,
          reactions: 0,
          cursors: 0,
          pointing: 0,
          own: 1,
        },
      ],
    });
    assert({
      given: 'the retained channel',
      should:
        'give the survivor only their own live messages and no channel authority at all',
      actual: [
        (await dm.retained.listRetainedConversations(survivor, unfenced)).map(
          (row) => [row.channelId, row.messages],
        ),
        (
          await dm.retained.readRetainedConversation(
            { ...survivor, channelId },
            unfenced,
          )
        ).map((row) => [row.id, row.text]),
        await readMessagingChannelFact(
          dm.database,
          channelId,
          survivor.actorId,
        ),
      ],
      expected: [[[channelId, 1]], [[ids.reply, 'Survivor reply']], null],
    });
    for (const caller of [
      dm.subject,
      { userId: createId(), actorId: createId() },
    ])
      await assertRejects({
        given: 'the erased subject, then a stranger',
        should: 'refuse the retained conversation as absent',
        actual: () =>
          dm.retained.readRetainedConversation(
            { ...caller, channelId },
            unfenced,
          ),
        code: 'NOT_FOUND',
      });
    await dm.retained.deleteRetainedConversation(
      { ...survivor, channelId },
      unfenced,
    );
    assert({
      given: 'the survivor deleting the conversation',
      should: 'leave no channel, message, grant or receipt behind',
      actual: await dm.residue(),
      expected: { channels: 0, messages: 0, grants: 0, receipts: 0 },
    });
  } finally {
    await dm.close();
  }
});

test('a survivor with no message of their own keeps nothing, their files included (DEC-126)', async () => {
  const dm = await openDm();
  const file = { id: createId(), objectKey: createId() };
  try {
    await dm.client.unsafe(
      'update messaging_messages set reply_to_message_id=null where channel_id=$1',
      [dm.channelId],
    );
    await dm.client.unsafe(
      'update messaging_messages set text=null, removed_at=created_at where id=$1',
      [dm.ids.reply],
    );
    await dm.client.unsafe(
      "insert into messaging_files(id,channel_id,owner_actor_id,request_id,object_key,filename,mime,reserved_bytes,generation,authority_revision,lifecycle,created_at,expires_at) values($1,$2,$3,$4,$5,'survivor.pdf','application/pdf',20,1,1,'reserved',$6,$6::timestamptz + interval '1 hour')",
      [
        file.id,
        dm.channelId,
        dm.survivor.actorId,
        createId(),
        file.objectKey,
        now,
      ],
    );
    await dm.erase(dm.subject);
    const intent = async () =>
      dm.client.unsafe(
        'select charged_bytes::int as charged from messaging_file_deletion_intents where object_key=$1',
        [file.objectKey],
      );
    const erased = {
      residue: await dm.residue(),
      files: (
        await dm.client.unsafe(
          'select count(*)::int as n from messaging_files where id=$1',
          [file.id],
        )
      )[0].n,
      intent: [...(await intent())],
      work: (await pendingFileDeletions(dm.database, 65535)).some(
        (work) => work.kind === 'erased' && work.objectKey === file.objectKey,
      ),
    };
    assert({
      given:
        'a survivor whose only message was already removed, holding a reserved upload in the DM',
      should:
        'delete the channel with everything in it and turn the upload into charged, opaque erasure work',
      actual: erased,
      expected: {
        residue: { channels: 0, messages: 0, grants: 0, receipts: 0 },
        files: 0,
        intent: [{ charged: 20 }],
        work: true,
      },
    });
    const removed: string[] = [];
    await acknowledgeErasedFileDeletion(
      dm.database,
      file.objectKey,
      async (key) => {
        removed.push(key);
      },
    );
    assert({
      given: 'the storage worker acknowledging the erased object',
      should: 'remove that object once and release its charge',
      actual: { removed, intent: [...(await intent())] },
      expected: { removed: [file.objectKey], intent: [] },
    });
  } finally {
    await dm.client.unsafe(
      'delete from messaging_file_deletion_intents where object_key=$1',
      [file.objectKey],
    );
    await dm.client.unsafe('delete from messaging_files where id=$1', [
      file.id,
    ]);
    await dm.close();
  }
});

test('erasing both DM members at once leaves zero rows (m6)', async () => {
  const dm = await openDm();
  try {
    await Promise.all([dm.erase(dm.subject), dm.erase(dm.survivor)]);
    assert({
      given: 'both members of a DM erased concurrently',
      should:
        'serialize on the pair and leave no channel, message, retained grant or receipt',
      actual: await dm.residue(),
      expected: { channels: 0, messages: 0, grants: 0, receipts: 0 },
    });
  } finally {
    await dm.close();
  }
});
