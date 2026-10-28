import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  createMessagingInboxPage,
  type MessagingInboxPolicy,
} from './inbox-page';
setupRitewayBun();
const now = '2026-10-10T12:00:00.000Z';
const self = { userId: 'u'.repeat(24), actorId: 'a'.repeat(24) };
const id = (prefix: string, n: number) =>
  `${prefix}${String(n).padStart(23, '0')}`;
const account = (actorId: string, userId: string) => ({
  userId,
  actorId,
  member: true,
  erased: false,
  revision: 1,
  betaState: 'approved',
  betaRevision: 1,
  ageBand: 'adult',
});
const dmFact = (channelId: string, other: string) => ({
  kind: 'channel',
  channelId,
  policyKey: 'social.dm',
  policyRevision: 1,
  lifecycle: 'active',
  revision: 1,
  authority: {
    kind: 'dm',
    lowActorId: self.actorId,
    highActorId: other,
    requestSenderActorId: self.actorId,
    state: 'accepted',
    blocked: false,
    revision: 1,
  },
});
/** A page of `size` accepted DMs, each with its own counterpart, answered by statement kind. */
function world(size: number, options: { readonly hidden?: boolean } = {}) {
  const channels = Array.from({ length: size }, (_, n) => ({
    channelId: id('c', n),
    other: id('b', n),
  }));
  const statements: string[] = [];
  const jsonParam = (params: unknown[]) =>
    JSON.parse(
      params.find((p) => typeof p === 'string' && p.startsWith('[')) as string,
    ) as Record<string, string | number>[];
  const answer = (statement: string, params: unknown[]): unknown[] => {
    if (statement.includes('daisy_authorization_accounts_v2(null::text[]'))
      return [account(self.actorId, self.userId)];
    if (statement.includes('union'))
      return channels.map((c) => ({
        channelId: c.channelId,
        hidden: options.hidden ?? false,
      }));
    if (statement.includes('jsonb_build_object'))
      return jsonParam(params).map((w) => ({
        index: w.i,
        fact: dmFact(
          String(w.channel_id),
          channels.find((c) => c.channelId === w.channel_id)!.other,
        ),
      }));
    if (statement.includes('daisy_authorization_read_accounts_v2'))
      return params.map((actorId, n) =>
        account(
          String(actorId),
          actorId === self.actorId ? self.userId : id('v', n),
        ),
      );
    if (statement.includes('for share of p'))
      return jsonParam(params).map((w) => ({
        lowActorId: w.low,
        highActorId: w.high,
        blocked: false,
        // bigint columns arrive as strings from the driver.
        revision: '1',
      }));
    if (statement.includes('daisy_messaging_channel_read_fence'))
      return jsonParam(params).map((w) => ({ channelId: w.id, locked: true }));
    if (statement.includes('messaging_messages'))
      return jsonParam(params).map((w) => ({
        channelId: w.channel_id,
        title: null,
        counterpart: 'kelvin',
        createdAt: now,
        lastText: null,
        lastAuthor: null,
        lastAt: null,
        unread: false,
        introduction: null,
        requestSender: null,
        requestedAt: null,
      }));
    // Pending invitations and age facts: none on this page.
    return [];
  };
  const tx = {
    execute: async (query: SQL) => {
      const { sql, params } = new PgDialect().sqlToQuery(query);
      statements.push(sql);
      return answer(sql, params);
    },
  };
  const database = {
    transaction: async (work: (value: typeof tx) => Promise<unknown>) =>
      work(tx),
  } as unknown as BunSQLDatabase;
  return { channels, statements, page: createMessagingInboxPage(database) };
}
type Decision = { readonly shown: true };
const policy = (
  allow: boolean,
  collection: MessagingInboxPolicy<Decision>['collection'] = () => {},
): MessagingInboxPolicy<Decision> => ({
  collection,
  decide: async () => (allow ? { shown: true } : null),
  summaryOf: () => ({ counterpartActorId: null, content: 'messages' }),
});

test('one inbox page is a constant number of statements, whatever its size', async () => {
  const one = world(1),
    hundred = world(100);
  const small = await one.page({ ...self, limit: 1, now }, policy(true));
  const large = await hundred.page({ ...self, limit: 100, now }, policy(true));
  assert({
    given: 'a page of 1 and a page of 100 visible candidates',
    should: 'read, fence and summarize both in the same statement count',
    actual: [
      one.statements.length,
      small.entries.length,
      large.entries.length,
      hundred.statements.length,
    ],
    expected: [one.statements.length, 1, 100, one.statements.length],
  });
  assert({
    given: 'the fences of a page',
    should:
      'take accounts, then pairs, then channels, each once and after discovery',
    actual: hundred.statements
      .map((sql) =>
        sql.includes('daisy_authorization_read_accounts_v2')
          ? 'accounts'
          : sql.includes('for share of p')
            ? 'pairs'
            : sql.includes('daisy_messaging_channel_read_fence')
              ? 'channels'
              : null,
      )
      .filter(Boolean),
    expected: ['accounts', 'pairs', 'channels'],
  });
});

test('a page whose candidates are all denied or hidden still advances', async () => {
  const denied = world(3);
  assert({
    given: 'a full scan where every candidate is denied',
    should: 'show nothing and continue after the last scanned candidate',
    actual: await denied.page({ ...self, limit: 3, now }, policy(false)),
    expected: { entries: [], nextAfter: denied.channels[2]!.channelId },
  });
  const hidden = world(3, { hidden: true });
  assert({
    given: 'a full scan where every candidate is hidden',
    should: 'fence and summarize nothing, yet continue past them',
    actual: [
      await hidden.page({ ...self, limit: 3, now }, policy(true)),
      hidden.statements.some((sql) => sql.includes('read_fence')),
    ],
    expected: [
      { entries: [], nextAfter: hidden.channels[2]!.channelId },
      false,
    ],
  });
  const short = world(2);
  assert({
    given: 'a scan shorter than the limit',
    should: 'end the inbox',
    actual: (await short.page({ ...self, limit: 3, now }, policy(true)))
      .nextAfter,
    expected: null,
  });
});

test('a refused collection reads no associations', async () => {
  const refused = world(2);
  await assertRejects({
    given: 'an inbox the reader may not open',
    should: 'refuse before scanning any association',
    code: 'AUTHORIZATION',
    actual: () =>
      refused.page(
        { ...self, limit: 2, now },
        policy(true, () => {
          throw createAppError('AUTHORIZATION');
        }),
      ),
  });
  assert({
    given: 'the refusal',
    should: 'have read only the unfenced own account',
    actual: refused.statements.length,
    expected: 1,
  });
});
