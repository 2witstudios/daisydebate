import { assert, setupRitewayBun, test } from 'riteway/bun';
import { expect } from 'bun:test';
import type { RedisTransport } from './transport';
import { createRedis } from './index';
import { typingLease } from './messaging-typing.test-support';
setupRitewayBun();
function subjectFixture() {
  const commands: unknown[] = [];
  const own = `test:v1:messaging-typing:${typingLease.actorId}:`,
    channel = 'd'.repeat(24);
  const values = new Map([
    [own + typingLease.channelId, JSON.stringify(typingLease)],
    [own + channel, JSON.stringify({ ...typingLease, channelId: channel })],
  ]);
  let pages: unknown[] = [
    ['7', [own + typingLease.channelId]],
    ['0', [own + channel, own + typingLease.channelId]],
  ];
  let refuseDeletion = false;
  let acknowledgement: number | undefined;
  const client: RedisTransport = {
    connect: async () => {},
    ping: async () => 'PONG',
    close: () => {},
    getdel: async () => null,
    get: async (key) => {
      if (typeof key !== 'string') throw new Error('Unexpected driver key');
      return values.get(key) ?? null;
    },
    del: async (key) => {
      if (typeof key !== 'string') throw new Error('Unexpected driver key');
      commands.push(['DEL', key]);
      if (refuseDeletion) throw new Error('Physical deletion unavailable');
      const removed = values.delete(key) ? 1 : 0;
      return acknowledgement ?? removed;
    },
    send: async (command, args) => {
      commands.push([command, ...args]);
      return pages.shift();
    },
  };
  return {
    redis: createRedis({
      url: 'redis://127.0.0.1:1',
      namespace: 'test',
      client,
    }),
    commands,
    own,
    channel,
    values,
    script: (input: unknown[]) => {
      pages = input;
    },
    outage: (value: boolean) => {
      refuseDeletion = value;
    },
    acknowledge: (value: number) => {
      acknowledgement = value;
    },
  };
}
test('typing subject export/deletion completes every cursor page and remains idempotent after outage', async () => {
  const f = subjectFixture();
  const exported = await f.redis.exportSubjectTyping(typingLease.actorId);
  const scans = f.commands.slice();
  f.script([
    ['9', [[...f.values.keys()][0]]],
    ['0', [[...f.values.keys()][1]]],
  ]);
  f.outage(true);
  await expect(f.redis.eraseSubjectTyping(typingLease.actorId)).rejects.toThrow(
    'Physical deletion unavailable',
  );
  const retained = f.values.size;
  f.outage(false);
  f.script([
    ['8', [[...f.values.keys()][0]]],
    ['0', [[...f.values.keys()][1]]],
  ]);
  await f.redis.eraseSubjectTyping(typingLease.actorId);
  f.script([['0', []]]);
  await f.redis.eraseSubjectTyping(typingLease.actorId);
  assert({
    given:
      'multi-page subject keys independent of channel membership, duplicate SCAN keys and physical vendor outage',
    should:
      'export exact bound leases once, retry real DEL and acknowledge only cursor-zero completion',
    actual: [exported, scans, retained, f.values.size],
    expected: [
      [typingLease, { ...typingLease, channelId: f.channel }],
      [
        ['SCAN', '0', 'MATCH', `${f.own}*`, 'COUNT', '500'],
        ['SCAN', '7', 'MATCH', `${f.own}*`, 'COUNT', '500'],
      ],
      2,
      0,
    ],
  });
});
test('typing physical erasure rejects invalid acknowledgement and export tolerates only actual absent keys', async () => {
  const f = subjectFixture();
  f.script([['0', [f.own + typingLease.channelId]]]);
  f.acknowledge(2);
  await expect(f.redis.eraseSubjectTyping(typingLease.actorId)).rejects.toThrow(
    'Invalid typing deletion acknowledgement',
  );
  f.script([['0', [f.own + typingLease.channelId]]]);
  assert({
    given: 'lease naturally absent before GET',
    should: 'export no fabricated retained data',
    actual: await f.redis.exportSubjectTyping(typingLease.actorId),
    expected: [],
  });
  f.script([['0', [f.own + f.channel]]]);
  f.values.set(f.own + f.channel, '{');
  await expect(
    f.redis.exportSubjectTyping(typingLease.actorId),
  ).rejects.toThrow('Invalid typing subject lease');
  f.script([['invalid', []]]);
  await expect(f.redis.eraseSubjectTyping(typingLease.actorId)).rejects.toThrow(
    'Invalid typing subject scan',
  );
});
test('typing subject scanner refuses foreign/malformed keys, driver loops and substituted lease associations', async () => {
  for (const key of [
    'foreign:v1:messaging-typing:' +
      typingLease.actorId +
      ':' +
      typingLease.channelId,
    'test:v1:messaging-typing:' + 'b'.repeat(24) + ':' + typingLease.channelId,
    'test:v1:messaging-typing:' + typingLease.actorId + ':bad:channel',
  ]) {
    const f = subjectFixture();
    f.script([['0', [key]]]);
    await expect(
      f.redis.eraseSubjectTyping(typingLease.actorId),
    ).rejects.toThrow('Invalid typing subject key');
    assert({
      given: 'foreign or malformed scanned key',
      should: 'perform no deletion',
      actual: f.commands.filter(
        (row) => Array.isArray(row) && row[0] === 'DEL',
      ),
      expected: [],
    });
  }
  const f = subjectFixture();
  f.script([
    ['4', []],
    ['4', []],
  ]);
  await expect(f.redis.eraseSubjectTyping(typingLease.actorId)).rejects.toThrow(
    'Invalid typing subject scan',
  );
  f.script([['0', [f.own + typingLease.channelId]]]);
  f.values.set(
    f.own + typingLease.channelId,
    JSON.stringify({ ...typingLease, actorId: 'b'.repeat(24) }),
  );
  await expect(
    f.redis.exportSubjectTyping(typingLease.actorId),
  ).rejects.toThrow('Invalid typing subject lease');
  const before = f.commands.length;
  await expect(f.redis.eraseSubjectTyping('invalid')).rejects.toThrow(
    'Invalid typing subject',
  );
  assert({
    given: 'invalid subject identifier',
    should: 'refuse before any Redis I/O',
    actual: f.commands.length,
    expected: before,
  });
});
