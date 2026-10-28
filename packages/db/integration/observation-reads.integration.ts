import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingTestFixture } from '../src/testing';
import { channelObservationReads } from '../src/messaging/observation-reads';
import { createMessagingChannelCohortAuthority } from '../src/messaging/authority-frame';
import { loadAuthorizationSessions } from '../src/authorization';
import { sqlStateOf } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

/** Appends `count` messages the way a writer does: rows plus one stream advance. */
async function append(
  client: SQL,
  channelId: string,
  authorActorId: string,
  count: number,
) {
  const [stream] = await client.unsafe(
    'select message_sequence::int as s, change_version::int as v from messaging_channel_streams where channel_id=$1',
    [channelId],
  );
  for (let index = 1; index <= count; index++)
    await client.unsafe(
      `insert into messaging_messages(id, channel_id, author_actor_id, sequence, change_version, text, created_at)
       values($1,$2,$3,$4,$5,$6,'2026-10-28T00:00:00Z')`,
      [
        createId(),
        channelId,
        authorActorId,
        stream.s + index,
        stream.v + index,
        `m${stream.s + index}`,
      ],
    );
  await client.unsafe(
    'update messaging_channel_streams set message_sequence=$2, change_version=$3 where channel_id=$1',
    [channelId, stream.s + count, stream.v + count],
  );
}

test('observation reads run as daisy_realtime through the SECURITY DEFINER reads only (ADR 0089)', async () => {
  const client = new SQL(databaseUrl);
  const fixture = await createMessagingTestFixture(client);
  try {
    await append(client, fixture.channelId, fixture.actorId, 3);
    const missing = createId();
    const [headers, window, empty] = await client.begin(async (tx) => {
      await tx`set local role daisy_realtime`;
      const reads = channelObservationReads(drizzle({ client: tx }));
      return [
        await reads.readChannelObservationHeaders([fixture.channelId, missing]),
        await reads.readChannelObservationWindow(fixture.channelId, 2),
        await reads.readChannelObservationWindow(missing, 2),
      ] as const;
    });
    const [stream] = await client.unsafe(
      'select s.change_version::int as v, c.authority_revision::int as a from messaging_channel_streams s join messaging_channels c on c.id=s.channel_id where s.channel_id=$1',
      [fixture.channelId],
    );
    assert({
      given: 'a channel with three messages and an unknown channel',
      should:
        'return the stream and authority revisions as one header per existing channel, and the newest limit + 1 messages with them',
      actual: {
        headers: [...headers.entries()],
        revisions: [window?.contentRevision, window?.disclosureRevision],
        sequences: window?.records.map((r) => r.sequence),
        empty,
      },
      expected: {
        headers: [
          [
            fixture.channelId,
            { contentRevision: stream.v, disclosureRevision: stream.a },
          ],
        ],
        revisions: [stream.v, stream.a],
        sequences: [3, 2, 1],
        empty: null,
      },
    });
    const refused = await Promise.all(
      [
        () =>
          client.begin(async (tx) => {
            await tx`set local role daisy_realtime`;
            await tx`select text from public.messaging_messages limit 1`;
          }),
        () =>
          client.begin(async (tx) => {
            await tx`set local role daisy_web`;
            await tx`select * from public.daisy_observation_channel_messages(${fixture.channelId}, 2)`;
          }),
      ].map(sqlStateOf),
    );
    assert({
      given:
        'the realtime role reading message text directly, and the web role calling the projection read',
      should:
        'refuse both: content reaches realtime only through the projection function',
      actual: refused,
      expected: ['42501', '42501'],
    });
  } finally {
    await fixture.cleanup();
    await client.close();
  }
});

test('a cohort read fences the cast once for every viewer of a channel', async () => {
  const client = new SQL(databaseUrl);
  const fixture = await createMessagingTestFixture(client);
  try {
    const cohort = createMessagingChannelCohortAuthority(drizzle({ client }));
    const viewers = [
      { actorId: fixture.actorId, userId: fixture.userId },
      { actorId: fixture.otherActorId, userId: fixture.otherUserId },
      { actorId: fixture.actorId, userId: fixture.userId },
    ];
    const result = await cohort(
      { channelId: fixture.channelId, viewers },
      async ({ accounts, factFor }) => ({
        accounts: accounts.map((a) => a?.actorId).sort(),
        facts: viewers.map((v) => factFor(v.actorId).channelId),
      }),
    );
    assert({
      given: 'three viewer sessions of two members',
      should: 'read both accounts once and a channel fact for every viewer',
      actual: result,
      expected: {
        accounts: [fixture.actorId, fixture.otherActorId].sort(),
        facts: [fixture.channelId, fixture.channelId, fixture.channelId],
      },
    });
  } finally {
    await fixture.cleanup();
    await client.close();
  }
});

test('a cohort read costs the same statements for 2 or 12 viewer sessions, and refuses expired and foreign sessions', async () => {
  const client = new SQL(databaseUrl);
  const fixture = await createMessagingTestFixture(client);
  const now = '2026-10-28T12:00:00.000Z';
  const sessions: string[] = [];
  const addSession = async (userId: string, expiresAt: string) => {
    const id = createId();
    sessions.push(id);
    await client.unsafe(
      'insert into session(id, expires_at, token, user_id) values($1,$2,$3,$4)',
      [id, expiresAt, createId(), userId],
    );
    return id;
  };
  try {
    const live = async (userId: string, actorId: string) => ({
      sessionId: await addSession(userId, '2026-10-29T00:00:00.000Z'),
      userId,
      actorId,
    });
    const member = { userId: fixture.userId, actorId: fixture.actorId };
    const other = {
      userId: fixture.otherUserId,
      actorId: fixture.otherActorId,
    };
    const small = [
      await live(member.userId, member.actorId),
      await live(other.userId, other.actorId),
    ];
    const large = [...small];
    for (let index = 0; index < 10; index++)
      large.push(
        await live(
          index % 2 ? member.userId : other.userId,
          index % 2 ? member.actorId : other.actorId,
        ),
      );
    const expired = {
      sessionId: await addSession(member.userId, '2026-10-28T11:59:59.000Z'),
      ...member,
    };
    const foreign = { ...small[0]!, actorId: other.actorId };
    const measure = async (viewers: typeof small) => {
      let statements = 0;
      const database = drizzle({
        client,
        logger: { logQuery: () => void statements++ },
      });
      const answers = await createMessagingChannelCohortAuthority(database)(
        { channelId: fixture.channelId, viewers },
        async ({ tx, accounts }) =>
          loadAuthorizationSessions(tx, { now, sessions: viewers, accounts }),
      );
      return { statements, answers };
    };
    const two = await measure(small);
    const twelve = await measure(large);
    const refused = await measure([...small, expired, foreign]);
    assert({
      given:
        '2 and then 12 viewer sessions of one DM, then an expired and a foreign session',
      should:
        'run the same number of statements, accept every live session and refuse the expired and foreign ones',
      actual: {
        sameCost: two.statements === twelve.statements,
        live: twelve.answers.every((answer) => answer !== null),
        refused: refused.answers.slice(2).map((answer) => answer),
        kept: refused.answers.slice(0, 2).every((answer) => answer !== null),
      },
      expected: {
        sameCost: true,
        live: true,
        refused: [null, null],
        kept: true,
      },
    });
  } finally {
    for (const id of sessions)
      await client.unsafe('delete from session where id = $1', [id]);
    // Deleting a live session appends its revocation control (G6 trigger).
    await client.unsafe(
      "delete from outbox where kind='session.revoked' and topic in ($1,$2)",
      [`user:${fixture.actorId}:inbox`, `user:${fixture.otherActorId}:inbox`],
    );
    await fixture.cleanup();
    await client.close();
  }
});
