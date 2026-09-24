import { expect, test } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { createHash } from 'node:crypto';
import { createRedis, redisKey } from '../src';
import { rawClient } from './test-support';
const url = process.env.TEST_REDIS_URL;
if (!url) throw new Error('TEST_REDIS_URL required');

const sha3 = (value: string) =>
  createHash('sha3-256').update(value).digest('hex');

test('a ticket is single-use: the second GETDEL finds nothing', async () => {
  const namespace = `test-${createId()}`;
  const redis = createRedis({ url, namespace });
  const actorId = createId();
  const sessionId = createId();
  const origin = 'https://daisydebate.example';
  const ticketHash = sha3(createId());
  try {
    await redis.issueConnectTicket(
      ticketHash,
      { actorId, sessionId, origin },
      60,
    );

    const first = await redis.consumeConnectTicket(ticketHash, origin);
    const replay = await redis.consumeConnectTicket(ticketHash, origin);

    expect(first).toEqual({ accepted: true, actorId, sessionId });
    // A negative control: a ticket consumed once must not be consumable
    // again, proving GETDEL actually removed it rather than merely reading it.
    expect(replay).toEqual({ accepted: false, reason: 'not-found' });
  } finally {
    redis.close();
  }
});

test('a ticket bound to a different origin is rejected, and still consumed', async () => {
  const namespace = `test-${createId()}`;
  const redis = createRedis({ url, namespace });
  const actorId = createId();
  const sessionId = createId();
  const origin = 'https://daisydebate.example';
  const ticketHash = sha3(createId());
  try {
    await redis.issueConnectTicket(
      ticketHash,
      { actorId, sessionId, origin },
      60,
    );

    const mismatched = await redis.consumeConnectTicket(
      ticketHash,
      'https://attacker.example',
    );
    const replay = await redis.consumeConnectTicket(ticketHash, origin);

    expect(mismatched).toEqual({ accepted: false, reason: 'origin-mismatch' });
    // Negative control: even a rejected (wrong-origin) consumption is single-use.
    expect(replay).toEqual({ accepted: false, reason: 'not-found' });
  } finally {
    redis.close();
  }
});

test('an expired ticket is rejected as not-found', async () => {
  const namespace = `test-${createId()}`;
  const redis = createRedis({ url, namespace });
  const raw = await rawClient(url);
  const actorId = createId();
  const sessionId = createId();
  const origin = 'https://daisydebate.example';
  const ticketHash = sha3(createId());
  const key = redisKey(namespace, 'ticket', ticketHash);
  try {
    await redis.issueConnectTicket(
      ticketHash,
      { actorId, sessionId, origin },
      60,
    );
    // Forces the stored ticket to have already expired, rather than
    // sleeping past its real TTL (flaky, and needlessly slow).
    await raw.send('PEXPIRE', [key, '-1']);

    expect(await redis.consumeConnectTicket(ticketHash, origin)).toEqual({
      accepted: false,
      reason: 'not-found',
    });
  } finally {
    redis.close();
    raw.close();
  }
});

test('an unknown ticket hash is rejected as not-found', async () => {
  const namespace = `test-${createId()}`;
  const redis = createRedis({ url, namespace });
  try {
    expect(
      await redis.consumeConnectTicket(sha3(createId()), 'https://x.example'),
    ).toEqual({ accepted: false, reason: 'not-found' });
  } finally {
    redis.close();
  }
});

test('the ticket key carries a mandatory TTL, never a bare SET', async () => {
  const namespace = `test-${createId()}`;
  const redis = createRedis({ url, namespace });
  const raw = await rawClient(url);
  const actorId = createId();
  const sessionId = createId();
  const origin = 'https://daisydebate.example';
  const ticketHash = sha3(createId());
  const key = redisKey(namespace, 'ticket', ticketHash);
  try {
    await redis.issueConnectTicket(
      ticketHash,
      { actorId, sessionId, origin },
      60,
    );
    const ttl = await raw.send('TTL', [key]);
    expect(Number(ttl)).toBeGreaterThan(0);
    expect(Number(ttl)).toBeLessThanOrEqual(60);
  } finally {
    await redis.consumeConnectTicket(ticketHash, origin);
    redis.close();
    raw.close();
  }
});
