import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readMessagingChannelFact } from '../src/messaging/social';
import { createMessagingStore } from '../src/messaging/store';
import { createMessagingPrivacyAdopter } from '../src/messaging/privacy';
import { lockAuthorizationActors } from '../src/authorization';
import {
  acknowledgeErasedFileDeletion,
  pendingFileDeletions,
} from '../src/messaging-files';
import { openDm as openDmAt } from './messaging-retained-dm.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const unfenced = async () => {};
/** No channel row left, and all three uploads turned into erasure work. */
const emptied = {
  channels: 0,
  messages: 0,
  grants: 0,
  receipts: 0,
  files: 0,
  intents: 3,
};
/**
 * The survivor's retained channel: their two messages, grant and receipts,
 * with only their attached file kept; both reserved uploads are erasure work.
 */
const retained = {
  channels: 1,
  messages: 2,
  grants: 1,
  receipts: 2,
  files: 1,
  intents: 2,
};
const openDm = () => openDmAt(databaseUrl);

test('Messaging erasure fences content and rolls back before file or receipt association cleanup on overflow', async () => {
  const dm = await openDm();
  const { client, subject, channelId, ids } = dm;
  const statements: string[] = [];
  const database = drizzle({
    client,
    logger: { logQuery: (query) => statements.push(query.trim()) },
  });
  const adopted = createMessagingPrivacyAdopter();
  const erase = () =>
    database.transaction(async (tx) => {
      await lockAuthorizationActors(tx, [subject.actorId], { maxActors: 1 });
      await adopted.erase(tx, subject, { now: '2026-10-27T12:00:01.000Z' });
    });
  try {
    await client`insert into messaging_reactions(channel_id,message_id,actor_id,reaction) values(${channelId},${ids.reply},${subject.actorId},'yes')`;
    await client`update messaging_channel_streams set change_version=${Number.MAX_SAFE_INTEGER} where channel_id=${channelId}`;
    const before = await dm.residue();
    await assertRejects({
      given: 'a real retained DM at its stream ceiling',
      should: 'refuse canonical erasure before association or file mutation',
      actual: erase,
      code: 'CONFLICT',
    });
    const afterRefusal = await dm.residue();
    const refusedDeletes = statements.some((sql) =>
      sql.startsWith('delete from'),
    );
    await client`update messaging_channel_streams set change_version=3 where channel_id=${channelId}`;
    statements.length = 0;
    await erase();
    const [stream] =
      await client`select authority_revision::int as authority,change_version::int as content from messaging_channels join messaging_channel_streams on channel_id=id where id=${channelId}`;
    const [peer] =
      await client`select text,change_version::int as version from messaging_messages where id=${ids.reply}`;
    const [bells] =
      await client`select count(*)::int as count from outbox where payload->>'channelId'=${channelId}`;
    const channels = statements.findIndex(
      (sql) =>
        sql.startsWith('select id from messaging_channels') &&
        sql.includes('order by id for update'),
    );
    const intent = statements.findIndex((sql) =>
      sql.startsWith('insert into messaging_file_deletion_intents'),
    );
    const deleted = statements.findIndex((sql) =>
      sql.startsWith('delete from messaging_files'),
    );
    assert({
      given:
        'a real subject post and subject reaction on the surviving peer’s post',
      should:
        'refuse overflow atomically, then fence channels first, transfer charges before delete, and advance content without a doorbell',
      actual: [
        adopted.phase,
        afterRefusal,
        refusedDeletes,
        channels >= 0 && channels < intent && intent < deleted,
        stream,
        peer,
        bells?.count,
      ],
      expected: [
        'before-auth',
        before,
        false,
        true,
        { authority: 2, content: 6 },
        { text: 'Survivor reply', version: 5 },
        0,
      ],
    });
  } finally {
    await dm.close();
  }
});

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
    assert({
      given: 'the subject erased',
      should:
        'keep the survivor’s attached file and turn both reserved uploads, theirs included, into erasure work',
      actual: await dm.residue(),
      expected: retained,
    });
    let reached = false;
    await assertRejects({
      given:
        'the survivor sending again on the retained channel, under a permissive fence',
      should:
        'refuse it as an absent channel at the channel fence, before the frame reads any receipt or content',
      actual: () =>
        createMessagingStore({
          database: dm.database,
          authorize: unfenced,
        }).withChannel({ ...survivor, channelId }, async () => {
          reached = true;
        }),
      code: 'NOT_FOUND',
    });
    assert({
      given: 'the refused send',
      should: 'never have opened the channel frame',
      actual: reached,
      expected: false,
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
      should:
        'leave no channel, message, grant, receipt or file behind, only erasure work for both uploads',
      actual: await dm.residue(),
      expected: emptied,
    });
  } finally {
    await dm.close();
  }
});

test('a survivor with no message of their own keeps nothing, their files included (DEC-126)', async () => {
  const dm = await openDm();
  const file = dm.files.survivor;
  try {
    await dm.client.unsafe(
      'update messaging_messages set reply_to_message_id=null where channel_id=$1',
      [dm.channelId],
    );
    await dm.client.unsafe(
      'update messaging_messages set text=null, removed_at=created_at where id=$1',
      [dm.ids.reply],
    );
    await dm.erase(dm.subject);
    const intent = async () =>
      dm.client.unsafe(
        'select charged_bytes::int as charged from messaging_file_deletion_intents where object_key=$1',
        [file.objectKey],
      );
    const erased = {
      residue: await dm.residue(),
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
        residue: emptied,
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
        'serialize on the pair and leave no channel, message, retained grant, receipt or file, only erasure work for both uploads',
      actual: await dm.residue(),
      expected: emptied,
    });
  } finally {
    await dm.close();
  }
});
