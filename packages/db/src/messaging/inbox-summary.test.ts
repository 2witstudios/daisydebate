import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { AuthorizationTransaction } from '../authorization';
import { readMessagingInboxSummary } from './inbox-summary';
setupRitewayBun();
const actorId = 'a'.repeat(24),
  otherActorId = 'b'.repeat(24),
  channelId = 'c'.repeat(24);
const row = {
  title: null,
  counterpart: 'kelvin',
  createdAt: '2026-10-01T10:00:00.000Z',
  lastText: null,
  lastAuthor: null,
  lastAt: null,
  unread: false,
  introduction: null,
  requestSender: null,
  requestedAt: null,
};
const transaction = (rows: readonly unknown[]) => {
  const statements: { sql: string; params: unknown[] }[] = [];
  const tx = {
    execute: async (query: SQL) => {
      statements.push(new PgDialect().sqlToQuery(query));
      return rows;
    },
  } as unknown as AuthorizationTransaction;
  return { tx, statements };
};
test('an approved conversation summarizes its newest surviving message and unread state', async () => {
  const { tx, statements } = transaction([
    {
      ...row,
      lastText: 'See you at the round',
      lastAuthor: otherActorId,
      lastAt: '2026-10-02T09:00:00.000Z',
      unread: true,
    },
  ]);
  assert({
    given: 'a direct conversation whose last message came from the counterpart',
    should: "title it with the counterpart's username and mark it unread",
    actual: await readMessagingInboxSummary(tx, {
      channelId,
      actorId,
      counterpartActorId: otherActorId,
      content: 'messages',
    }),
    expected: {
      title: 'kelvin',
      lastMessage: {
        text: 'See you at the round',
        fromSelf: false,
        createdAt: '2026-10-02T09:00:00.000Z',
      },
      introduction: null,
      createdAt: '2026-10-01T10:00:00.000Z',
      unread: true,
    },
  });
  assert({
    given: 'the summary query',
    should: 'exclude removed messages and own messages from unread',
    actual: [
      statements[0]?.sql.includes('removed_at is null'),
      statements[0]?.sql.includes('author_actor_id <>'),
      statements[0]?.sql.includes('deleted_at is null'),
    ],
    expected: [true, true, true],
  });
});
test('a group conversation is titled by its group name', async () => {
  const { tx } = transaction([
    { ...row, title: 'Policy club', counterpart: null },
  ]);
  const summary = await readMessagingInboxSummary(tx, {
    channelId,
    actorId,
    counterpartActorId: null,
    content: 'messages',
  });
  assert({
    given: 'a private group with no messages yet',
    should: 'use the group title and report no preview',
    actual: [summary.title, summary.lastMessage, summary.unread],
    expected: ['Policy club', null, false],
  });
});
test('a pending request summarizes only its introduction', async () => {
  const pending = {
    ...row,
    introduction: 'Want to practice?',
    requestSender: otherActorId,
    requestedAt: '2026-10-03T08:00:00.000Z',
  };
  const incoming = transaction([pending]);
  assert({
    given: 'an incoming request',
    should: 'show the introduction and mark it unread',
    actual: await readMessagingInboxSummary(incoming.tx, {
      channelId,
      actorId,
      counterpartActorId: otherActorId,
      content: 'introduction',
    }),
    expected: {
      title: 'kelvin',
      lastMessage: null,
      introduction: {
        text: 'Want to practice?',
        fromSelf: false,
        requestedAt: '2026-10-03T08:00:00.000Z',
      },
      createdAt: '2026-10-01T10:00:00.000Z',
      unread: true,
    },
  });
  const outgoing = transaction([{ ...pending, requestSender: actorId }]);
  const sent = await readMessagingInboxSummary(outgoing.tx, {
    channelId,
    actorId,
    counterpartActorId: otherActorId,
    content: 'introduction',
  });
  assert({
    given: 'a request the reader sent',
    should: 'mark the introduction as their own and never unread',
    actual: [sent.introduction?.fromSelf, sent.unread],
    expected: [true, false],
  });
  assert({
    given: 'the request summary query',
    should: 'never select message history',
    actual: incoming.statements[0]?.params.includes(false),
    expected: true,
  });
});
test('a deleted counterpart and refused inputs', async () => {
  const { tx } = transaction([{ ...row, counterpart: null }]);
  const summary = await readMessagingInboxSummary(tx, {
    channelId,
    actorId,
    counterpartActorId: otherActorId,
    content: 'messages',
  });
  assert({
    given: 'a counterpart whose account was erased',
    should: 'return no title rather than a stale name',
    actual: summary.title,
    expected: null,
  });
  await assertRejects({
    given: 'a malformed channel ID',
    should: 'refuse before querying',
    actual: () =>
      readMessagingInboxSummary(transaction([row]).tx, {
        channelId: 'nope',
        actorId,
        counterpartActorId: null,
        content: 'messages',
      }),
    code: 'VALIDATION',
  });
  await assertRejects({
    given: 'a channel that no longer exists',
    should: 'report it as not found',
    actual: () =>
      readMessagingInboxSummary(transaction([]).tx, {
        channelId,
        actorId,
        counterpartActorId: null,
        content: 'messages',
      }),
    code: 'NOT_FOUND',
  });
});
