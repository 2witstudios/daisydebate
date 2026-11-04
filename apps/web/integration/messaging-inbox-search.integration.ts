import { requireTestServices } from '@daisy/config';
import {
  createMessagingTestFixture,
  seedMessagingTestDm,
} from '@daisy/db/testing';
import { createDatabase } from '@daisy/db';
import { createId } from '@paralleldrive/cuid2';
import { SQL } from 'bun';
import { expect } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { composeMessagingInbox } from '../src/features/messaging/inbox-composition';
import { createInboxReads } from '../src/features/messaging/inbox-reads';
import { appendPage } from '../src/features/messaging/inbox-view';
import {
  messagingFixturePosting,
  messagingFixtureReading,
} from './messaging-policy.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

/** One reader with a DM to each of `count` other members, messages under the test's control. */
async function openReader(count: number) {
  const client = new SQL(databaseUrl);
  const database = createDatabase({ url: databaseUrl, nextActorId: createId });
  const fixtures = await Promise.all(
    Array.from({ length: count }, () => createMessagingTestFixture(client)),
  );
  const reader = fixtures[0]!;
  const channels = [reader.channelId];
  const others = [
    { actorId: reader.otherActorId, username: reader.otherUserId },
  ];
  for (const fixture of fixtures.slice(1)) {
    const channelId = createId();
    await seedMessagingTestDm(client, {
      actorId: reader.actorId,
      otherActorId: fixture.otherActorId,
      channelId,
      now: reader.now,
    });
    channels.push(channelId);
    others.push({
      actorId: fixture.otherActorId,
      username: fixture.otherUserId,
    });
  }
  const inbox = composeMessagingInbox({
    database,
    principal: {
      kind: 'user',
      userId: reader.userId,
      actorId: reader.actorId,
    },
    clock: { now: () => reader.now },
    postingPolicy: messagingFixturePosting,
    readingPolicy: messagingFixtureReading,
  });
  const post = async (
    index: number,
    text: string,
    at: string,
    sequence = 1,
  ) => {
    await client.unsafe(
      'insert into messaging_messages(id,channel_id,author_actor_id,sequence,change_version,text,created_at) values($1,$2,$3,$4,$4,$5,$6)',
      [createId(), channels[index], others[index]!.actorId, sequence, text, at],
    );
    await client.unsafe(
      'update messaging_channel_streams set message_sequence=$2, change_version=$2 where channel_id=$1',
      [channels[index], sequence],
    );
  };
  const close = async () => {
    for (const channelId of channels)
      await client.unsafe('delete from messaging_channels where id=$1', [
        channelId,
      ]);
    await client.unsafe(
      'delete from contact_pairs where low_actor_id=$1 or high_actor_id=$1',
      [reader.actorId],
    );
    for (const fixture of fixtures) await fixture.cleanup();
    await database.close();
    await client.close();
  };
  return { client, reader, channels, others, inbox, post, close };
}

const found = async (
  world: Awaited<ReturnType<typeof openReader>>,
  search: string,
) =>
  (await world.inbox.read({ limit: 10, search })).entries.map(
    (entry) => entry.channelId,
  );

test('the inbox reads newest activity first across pages, with a stable tie-break', async () => {
  const world = await openReader(4);
  try {
    const { channels, post, inbox } = world;
    await post(0, 'oldest', '2026-10-09T10:00:00.000Z');
    await post(1, 'newest', '2026-10-09T13:00:00.000Z');
    await post(2, 'tied', '2026-10-09T12:00:00.000Z');
    await post(3, 'tied', '2026-10-09T12:00:00.000Z');
    const tied = [channels[2]!, channels[3]!].sort();
    const first = await inbox.read({ limit: 2 });
    const second = await inbox.read({
      limit: 2,
      after: first.nextAfter ?? '',
    });
    assert({
      given: 'more conversations than one page, two at the same instant',
      should: 'order every page by newest activity with no gap or repeat',
      actual: [...first.entries, ...second.entries].map(
        (entry) => entry.channelId,
      ),
      expected: [channels[1], tied[0], tied[1], channels[0]],
    });
    const third = await inbox.read({
      limit: 2,
      after: second.nextAfter ?? '',
    });
    assert({
      given: 'the page after the last conversation',
      should: 'be empty and end the read',
      actual: third,
      expected: { entries: [], nextAfter: null },
    });
  } finally {
    await world.close();
  }
});

test('a refresh drops a conversation that left from a later page', async () => {
  const world = await openReader(3);
  try {
    const { channels, others, reader, post, client, inbox } = world;
    await post(0, 'newest', '2026-10-09T13:00:00.000Z');
    await post(1, 'middle', '2026-10-09T12:00:00.000Z');
    await post(2, 'oldest', '2026-10-09T11:00:00.000Z');
    const readPage = ({ after }: { readonly after: string | null }) =>
      inbox.read({ limit: 1, ...(after === null ? {} : { after }) });
    let view: Awaited<ReturnType<typeof readPage>> = {
      entries: [],
      nextAfter: null,
    };
    const applied = Promise.withResolvers<void>();
    const reads = createInboxReads({
      readPage,
      initialPages: 1,
      scheduler: {
        after: (work) => {
          queueMicrotask(work);
          return () => undefined;
        },
      },
      onRefreshed: (page) => {
        view = { ...page, entries: [...page.entries] };
        applied.resolve();
      },
      onNextPage: (page) => {
        view = {
          ...appendPage(view, page),
          entries: [...appendPage(view, page).entries],
        };
      },
    });
    const first = await readPage({ after: null });
    view = first;
    await reads.more(first.nextAfter ?? '');
    await reads.more(view.nextAfter ?? '');
    const shown = () => view.entries.map((entry) => entry.channelId);
    assert({
      given: 'three loaded pages of one conversation each',
      should: 'show all three, newest first',
      actual: shown(),
      expected: channels,
    });
    // Revoke the one on page two: the reader's own hiding, then a decline on page three.
    await client.unsafe(
      "insert into messaging_actor_states(channel_id,actor_id,following,hidden,notification_level,read_sequence) values($1,$2,false,true,'none',0)",
      [channels[1], reader.actorId],
    );
    await client.unsafe(
      "update messaging_dm_pairs set request_state='declined', decided_at=$2 where channel_id=$1",
      [channels[2], reader.now],
    );
    expect(others.length).toBe(3);
    reads.ring();
    await applied.promise;
    assert({
      given:
        'a hidden conversation on page two and a declined one on page three',
      should: 'drop both on the next ring, keeping page one',
      actual: shown(),
      expected: [channels[0]],
    });
    reads.close();
  } finally {
    await world.close();
  }
});

test('a search finds what a row shows and nothing it does not', async () => {
  const world = await openReader(5);
  try {
    const { channels, others, post, client } = world;
    const at = '2026-10-09T12:00:00.000Z';
    // Clipped: 119 visible units, the ellipsis, then a tail no reader sees.
    await post(0, `${'a'.repeat(119)}TAILWORD and more`, at);
    await post(1, 'Hungary\n\n  card \tnotes', at);
    // An astral character takes two units, so the excerpt clips earlier than 120 characters.
    await post(2, `${'😀'.repeat(59)}x${'😀'.repeat(5)}EMOJITAIL`, at);
    await post(3, 'an old line with SECRETHISTORY', at, 1);
    await post(3, 'a newer line', '2026-10-09T12:30:00.000Z', 2);
    await client.unsafe(
      "update messaging_dm_pairs set request_state='pending', decided_at=null, request_sender_actor_id=$2, introduction=$3 where channel_id=$1",
      [channels[4], others[4]!.actorId, 'Spar  on\ncarbon pricing?'],
    );
    const cases: readonly (readonly [string, string, readonly unknown[]])[] = [
      ['a clipped tail', 'TAILWORD', []],
      ['a clipped character 120', `${'a'.repeat(119)}T`, []],
      ['the shown clip', 'a'.repeat(119), [channels[0]]],
      ['whitespace as a row collapses it', 'hungary card notes', [channels[1]]],
      ['padded and mixed-case whitespace', '  CARD \n NOTES ', [channels[1]]],
      ['an emoji tail past the clip', 'EMOJITAIL', []],
      ['a shown emoji run', '😀😀x', [channels[2]]],
      ['older history', 'SECRETHISTORY', []],
      ['the newest line', 'NEWER LINE', [channels[3]]],
      ['a pending introduction', 'spar on carbon', [channels[4]]],
      ['a username', others[1]!.username, [channels[1]]],
      ['a literal percent', '%', []],
      ['a literal underscore run', '__', []],
    ];
    for (const [given, search, expected] of cases)
      assert({
        given: `a search for ${given}`,
        should: 'match exactly the rows showing it',
        actual: await found(world, search),
        expected,
      });
  } finally {
    await world.close();
  }
});

test('a search keeps the fenced decision, hidden rows and erased names out', async () => {
  const world = await openReader(4);
  try {
    const { channels, others, reader, post, client } = world;
    const at = '2026-10-09T12:00:00.000Z';
    await post(0, 'findable blocked accepted', at);
    await post(1, 'findable hidden', at);
    const block = (otherActorId: string) => {
      const [low, high] = [reader.actorId, otherActorId].sort();
      return client.unsafe(
        'update contact_pairs set low_blocks_high=true,revision=revision+1 where low_actor_id=$1 and high_actor_id=$2',
        [low, high],
      );
    };
    await block(others[0]!.actorId);
    await block(others[2]!.actorId);
    await client.unsafe(
      "insert into messaging_actor_states(channel_id,actor_id,following,hidden,notification_level,read_sequence) values($1,$2,false,true,'none',0)",
      [channels[1], reader.actorId],
    );
    await client.unsafe(
      "update messaging_dm_pairs set request_state='pending', decided_at=null, request_sender_actor_id=$2, introduction='findable blocked pending' where channel_id=$1",
      [channels[2], others[2]!.actorId],
    );
    await client.unsafe('update users set deleted_at=$2 where id=$1', [
      others[3]!.username,
      at,
    ]);
    assert({
      given:
        'a blocked accepted DM, a hidden one and a blocked pending request',
      should: 'find only the accepted DM the inbox still shows',
      actual: await found(world, 'findable'),
      expected: [channels[0]],
    });
    assert({
      given: 'the username of a deleted account',
      should: 'not find its conversation',
      actual: await found(world, others[3]!.username),
      expected: [],
    });
  } finally {
    await world.close();
  }
});

test('a withheld pagination anchor discloses no hidden activity and still continues', async () => {
  const world = await openReader(2);
  try {
    await world.post(0, 'Hidden newer activity', '2026-10-09T13:00:00.000Z');
    await world.post(1, 'Visible older activity', '2026-10-09T12:00:00.000Z');
    await world.client.unsafe(
      "insert into messaging_actor_states(channel_id,actor_id,following,hidden,notification_level,read_sequence) values($1,$2,false,true,'none',0)",
      [world.channels[0], world.reader.actorId],
    );
    const first = await world.inbox.read({ limit: 1 });
    assert({
      given: 'a hidden conversation occupying the scanned first page',
      should: 'omit it and withhold its activity from the continuation',
      actual: first,
      expected: { entries: [], nextAfter: `withheld~${world.channels[0]}` },
    });
    const second = await world.inbox.read({
      limit: 1,
      after: first.nextAfter!,
    });
    assert({
      given: 'the withheld anchor on the next bounded read',
      should: 'continue to the visible older conversation',
      actual: second.entries.map((entry) => entry.channelId),
      expected: [world.channels[1]],
    });
    await world.client.unsafe('delete from messaging_channels where id=$1', [
      world.channels[0],
    ]);
    assert({
      given:
        'the withheld association disappears before its continuation is used',
      should: 'restart safely within the remaining own associations',
      actual: (
        await world.inbox.read({ limit: 1, after: first.nextAfter! })
      ).entries.map((entry) => entry.channelId),
      expected: [world.channels[1]],
    });
  } finally {
    await world.close();
  }
});

test('the displayed truncation mark is searchable', async () => {
  const world = await openReader(1);
  try {
    await world.post(0, `${'x'.repeat(119)}TAIL`, world.reader.now);
    assert({
      given: 'a clipped preview ending in x and the displayed ellipsis',
      should: 'match its visible suffix without matching hidden text',
      actual: [await found(world, 'x…'), await found(world, 'TAIL')],
      expected: [world.channels, []],
    });
  } finally {
    await world.close();
  }
});
