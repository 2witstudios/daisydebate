import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { messagingAuthorityFixture } from './social.test-support';
/** Real Drizzle/authority discovery over the scripted wire; no feature evaluator or fake frame. */
export function messagingAuthorityWire(script: Parameters<typeof fakeSql>[0]) {
  const fact = messagingAuthorityFixture();
  const scope = {
    actorId: 'a'.repeat(24),
    userId: 'u'.repeat(24),
    channelId: fact.channelId,
  };
  const now = '2026-10-09T18:00:00.000Z';
  const { client, queries } = fakeSql([
    [{ fact }],
    [
      {
        actorId: scope.actorId,
        userId: scope.userId,
        member: true,
        erased: false,
        revision: 1,
      },
      {
        actorId: 'b'.repeat(24),
        userId: 'v'.repeat(24),
        member: true,
        erased: false,
        revision: 1,
      },
    ],
    [{ locked: true }],
    [{ fact }],
    ...script,
  ]);
  return { database: drizzle({ client }), queries, scope, fact, now };
}

export function channelWire(script: Parameters<typeof fakeSql>[0]) {
  const channel = [
    'c'.repeat(24),
    'dm',
    'social.dm',
    1,
    'active',
    null,
    null,
    0,
    1,
    1,
    new Date('2026-10-09T18:00:00.000Z'),
  ];
  return messagingAuthorityWire([[channel], ...script]);
}
