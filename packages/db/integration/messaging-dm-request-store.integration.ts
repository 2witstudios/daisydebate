import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { and, eq } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { contactReactions } from '../src/contact-composition';
import { dmRequestFrame } from '../src/messaging/social-request';
import { socialLimits } from './contact-pair-store.test-support';
import { contactPairs } from '../src/schema/contacts';
import { createMessagingTestFixture } from '../src/testing';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
type Frame = ReturnType<typeof dmRequestFrame>;

const withDmRequests = async (
  work: (fixture: {
    client: SQL;
    actorId: string;
    peerId: string;
    channelId: string;
    nextChannel: string;
    now: string;
    command: Parameters<Frame['commitDmRequest']>[0];
    frame: <T>(
      work: (frame: Frame) => Promise<T>,
      authorize?: () => Promise<void>,
      duplicate?: boolean,
    ) => Promise<T>;
    statements: string[];
  }) => Promise<void>,
) => {
  const client = new SQL(url);
  const fixture = await createMessagingTestFixture(client);
  const {
    actorId,
    userId,
    otherActorId: peerId,
    channelId,
    now,
    low,
    high,
  } = fixture;
  const nextChannel = createId();
  const statements: string[] = [];
  const db = drizzle({
    client,
    logger: { logQuery: (query) => statements.push(query.trim()) },
  });
  try {
    if (!low || !high) throw new Error('DM fixture contact key absent');
    await work({
      client,
      actorId,
      peerId,
      channelId,
      nextChannel,
      now,
      statements,
      command: {
        channelId: nextChannel,
        requestId: createId(),
        introduction: 'Proof introduction',
        digest: 'd'.repeat(64),
        now,
        policyRevision: 1,
        limits: socialLimits,
        nextId: createId,
      },
      frame: (use, authorize = async () => {}, duplicate = false) =>
        db.transaction(async (tx) => {
          const [pair] = await tx
            .select()
            .from(contactPairs)
            .where(
              and(
                eq(contactPairs.lowActorId, low),
                eq(contactPairs.highActorId, high),
              ),
            )
            .for('update');
          if (!pair) throw new Error('DM contact fixture absent');
          statements.length = 0;
          return use(
            dmRequestFrame(
              tx,
              {
                actorId,
                userId,
                memberActorIds: [actorId, peerId],
                policyRevision: 1,
              },
              duplicate ? [pair, pair] : [pair],
              authorize,
              contactReactions.relations,
            ),
          );
        }),
    });
  } finally {
    await client`delete from notifications where dm_channel_id in (${channelId},${nextChannel})`;
    await client`delete from messaging_social_commands where result_channel_id=${nextChannel}`;
    await client`delete from messaging_channels where id=${nextChannel}`;
    await fixture.cleanup();
    await client.close();
  }
};

test('the DM request screen converges only pending and accepted pairs and checks declines before spending', () =>
  withDmRequests(
    async ({
      client,
      actorId,
      peerId,
      channelId,
      now,
      frame,
      command,
      statements,
    }) => {
      const screen = () => frame((current) => current.screenDmRequest(now));
      const reads = () =>
        statements.map((query) =>
          query.includes('social_request_declines')
            ? 'declines'
            : query.includes('"messaging_channels"') &&
                query.endsWith('for update')
              ? 'channel'
              : query.includes('"messaging_dm_pairs"')
                ? 'pair'
                : query,
        );
      for (const state of ['accepted', 'pending'] as const) {
        await client`update messaging_dm_pairs set request_state=${state},decided_at=${state === 'accepted' ? now : null} where channel_id=${channelId}`;
        const result = await screen();
        assert({
          given: `an existing ${state} DM`,
          should: 'converge with only its minimal pair read',
          actual: [result, reads()],
          expected: [{ channelId, state }, ['pair']],
        });
        await assertRejects({
          given: 'a caller bypassing screen',
          should: 'refuse the duplicate commit',
          actual: () => frame((current) => current.commitDmRequest(command)),
          code: 'CONFLICT',
        });
      }
      await client`update messaging_dm_pairs set request_state='declined',decided_at=${now} where channel_id=${channelId}`;
      const active = await screen();
      assert({
        given: 'a declined DM on an active channel with no decline block',
        should:
          'lock its channel then read decline policy before permitting commit',
        actual: [active, reads()],
        expected: [null, ['pair', 'channel', 'declines']],
      });
      await client`update messaging_channels set lifecycle='archived' where id=${channelId}`;
      await assertRejects({
        given: 'the same pair with an archived channel',
        should: 'refuse before decline spending',
        actual: screen,
        code: 'AUTHORIZATION',
      });
      assert({
        given: 'the archived refusal',
        should: 'stop after the channel lock',
        actual: reads(),
        expected: ['pair', 'channel'],
      });
      await client`update messaging_channels set lifecycle='active' where id=${channelId}`;
      await client`insert into social_request_declines (decliner_actor_id, requester_actor_id, low_actor_id, high_actor_id, declined_count, last_declined_at, blocked_until, expires_at)
      values(${peerId},${actorId},least(${actorId},${peerId}),greatest(${actorId},${peerId}),0,${now},${now}::timestamptz+interval '1 hour',${now}::timestamptz+interval '1 hour')`;
      await assertRejects({
        given: 'a declined active DM blocked by the peer',
        should: 'refuse as an authorization block',
        actual: screen,
        code: 'AUTHORIZATION',
      });
      assert({
        given: 'the declined screen under a block',
        should: 'read the pair, channel and declines only',
        actual: reads(),
        expected: ['pair', 'channel', 'declines'],
      });
      await client`delete from messaging_dm_pairs where channel_id=${channelId}`;
      await assertRejects({
        given: 'a new pair still under the decline block',
        should: 'refuse before spending',
        actual: screen,
        code: 'AUTHORIZATION',
      });
      await client`delete from social_request_declines where decliner_actor_id=${peerId} and requester_actor_id=${actorId}`;
      const notRecorded = await frame((current) => current.readDmRequest());
      const fresh = await screen();
      assert({
        given: 'a new request without a block',
        should: 'read no existing result and authorize a separate commit',
        actual: [notRecorded, fresh, reads()],
        expected: [null, null, ['pair', 'declines']],
      });
    },
  ));

test('DM request commit reopens the same durable channel under native budget and authority fences', () =>
  withDmRequests(
    async ({
      client,
      actorId,
      peerId,
      channelId,
      now,
      nextChannel,
      frame,
      command,
      statements,
    }) => {
      const commit = (request = command) =>
        frame((current) => current.commitDmRequest(request));
      for (const [action, code] of [
        [
          () =>
            frame(
              (f) => f.readDmRequest(),
              async () => {
                throw createAppError('AUTHORIZATION');
              },
            ),
          'AUTHORIZATION',
        ],
        [
          () =>
            frame(
              (f) => f.commitDmRequest(command),
              async () => {
                throw createAppError('AUTHORIZATION');
              },
            ),
          'AUTHORIZATION',
        ],
        [() => frame((f) => f.readDmRequest(), undefined, true), 'VALIDATION'],
        [() => commit({ ...command, policyRevision: 2 }), 'CONFLICT'],
      ] as const) {
        await assertRejects({
          given: 'an invalid DM admission',
          should: 'refuse before any request SQL',
          actual: action,
          code,
        });
        assert({
          given: 'the refused admission',
          should: 'touch no request table',
          actual: statements,
          expected: [],
        });
      }
      await client`update messaging_dm_pairs set request_state='declined',decided_at=${now} where channel_id=${channelId}`;
      for (const invalid of [
        { ...command, now: 'invalid' },
        { ...command, limits: { ...command.limits, daily: 0 } },
      ]) {
        await assertRejects({
          given: 'invalid timing or limits',
          should: 'refuse before the budget query',
          actual: () => commit(invalid),
          code: 'VALIDATION',
        });
        assert({
          given: 'the malformed request',
          should: 'read the pair only',
          actual: statements.length,
          expected: 1,
        });
      }
      const previous = createId();
      await client`insert into social_requests(actor_id,request_id,counterpart_actor_id,kind,unrelated,created_at) values(${actorId},${previous},${peerId},'dm',true,${now})`;
      for (const limits of [
        { ...socialLimits, daily: 1 },
        { ...socialLimits, unrelatedHourly: 1 },
      ])
        await assertRejects({
          given: 'an exhausted real social ledger budget',
          should: 'refuse even for a previously declined pair',
          actual: () => commit({ ...command, limits }),
          code: 'RATE_LIMIT',
        });
      await client`update messaging_channels set lifecycle='archived' where id=${channelId}`;
      await assertRejects({
        given: 'a declined request whose channel is archived',
        should: 'refuse without creating another channel',
        actual: () => commit(),
        code: 'AUTHORIZATION',
      });
      await client`update messaging_channels set lifecycle='active', authority_revision=${Number.MAX_SAFE_INTEGER} where id=${channelId}`;
      await assertRejects({
        given: 'a declined request at the authority revision ceiling',
        should: 'refuse before any write',
        actual: () => commit(),
        code: 'CONFLICT',
      });
      assert({
        given: 'the authority revision refusal',
        should: 'remain on reads',
        actual: statements.every((query) => query.startsWith('select')),
        expected: true,
      });
      await client`update messaging_channels set authority_revision=2 where id=${channelId}`;
      await client`update messaging_channel_streams set change_version=4 where channel_id=${channelId}`;
      const reopened = await commit();
      const [stored] =
        await client`select p.request_state, p.introduction, p.decided_at, c.authority_revision::int as authority, s.change_version::int as stream, r.unrelated from messaging_dm_pairs p join messaging_channels c on c.id=p.channel_id join messaging_channel_streams s on s.channel_id=c.id join social_requests r on r.request_id=${command.requestId} where c.id=${channelId}`;
      assert({
        given: 'a declined active DM inside its durable budget',
        should:
          'reuse its locked channel, replace only request facts and advance authority and stream once',
        actual: [
          reopened,
          stored,
          statements.some((query) =>
            query.startsWith('insert into "messaging_channels"'),
          ),
        ],
        expected: [
          { channelId, state: 'pending' },
          {
            request_state: 'pending',
            introduction: command.introduction,
            decided_at: null,
            authority: 3,
            stream: 5,
            unrelated: true,
          },
          false,
        ],
      });
      await client`delete from messaging_dm_pairs where channel_id=${channelId}`;
      const fresh = await commit({ ...command, requestId: createId() });
      const [newStream] =
        await client`select message_sequence::int as sequence, change_version::int as version from messaging_channel_streams where channel_id=${nextChannel}`;
      const [privateWords] =
        await client`select count(*)::int as count from outbox where payload::text like ${`%${command.introduction}%`}`;
      assert({
        given: 'an admitted first request after removing the old pair fixture',
        should:
          'allocate one new pending channel and stream without durable content in invalidations',
        actual: [fresh, newStream, privateWords?.count],
        expected: [
          { channelId: nextChannel, state: 'pending' },
          { sequence: 0, version: 1 },
          0,
        ],
      });
    },
  ));
