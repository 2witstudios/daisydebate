import { createAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMediaNodes } from './media-nodes';
import type { createMediaService } from './service';

setupRitewayBun();

type Service = ReturnType<typeof createMediaService>;
const nodes = [
  { url: 'https://a.invalid', publicUrl: 'wss://a.invalid' },
  { url: 'https://b.invalid', publicUrl: 'wss://b.invalid' },
];
const down = () => Promise.reject(createAppError('INFRASTRUCTURE', 'down'));
const fixture = (a: Partial<Service>, b: Partial<Service>, up: string[]) =>
  createMediaNodes({
    nodes,
    apiKey: 'key',
    apiSecret: 'secret',
    services: [a as Service, b as Service],
    fetch: async (url) => {
      if (!up.some((host) => url.includes(host))) throw new Error('refused');
      return new Response('OK');
    },
  });

test('a read moves past a node that faults; a definite answer stands', async () => {
  const asked: string[] = [];
  const service = fixture(
    {
      exists: () => (asked.push('a'), down()),
      participants: () => (
        asked.push('a'),
        Promise.reject(createAppError('NOT_FOUND'))
      ),
    },
    {
      exists: async () => (asked.push('b'), true),
      participants: async () => (asked.push('b'), []),
    },
    ['a.invalid', 'b.invalid'],
  );
  const answer = await service.exists('room');
  const refused = await service.participants('room').catch((e) => e.code);
  assert({
    given: 'node A faulting on one read and refusing another',
    should: 'answer from B for the fault, and keep the refusal',
    actual: [answer, refused, asked],
    expected: [true, 'NOT_FOUND', ['a', 'b', 'a']],
  });
});

test('a write goes to one healthy node and is never repeated', async () => {
  const asked: string[] = [];
  const service = fixture(
    { permissions: () => (asked.push('a'), down()) },
    { permissions: async () => void asked.push('b') },
    ['b.invalid'],
  );
  const grants = { publish: [], subscribe: true, capture: false };
  await service.permissions('room', 'seat', grants).catch(() => undefined);
  await service.probe();
  await service.permissions('room', 'seat', grants);
  assert({
    given: 'one call before the probe sees A down, and one after',
    should: 'send each to exactly one node, and B once A is known down',
    actual: asked,
    expected: ['a', 'b'],
  });
});

test('a client joins through a healthy node, stable per room', async () => {
  const service = fixture({}, {}, ['b.invalid']);
  const before = [service.urlsFor('room-1'), service.urlsFor('room-1')];
  await service.probe();
  assert({
    given: 'the same room asked twice with every node healthy',
    should: 'give the same node',
    actual: before[0],
    expected: before[1],
  });
  assert({
    given: 'node A down',
    should: 'send every room to B, with a socket URL for workers',
    actual: ['room-1', 'room-2', 'room-3'].map((room) => service.urlsFor(room)),
    expected: Array(3).fill({
      publicUrl: 'wss://b.invalid',
      workerUrl: 'wss://b.invalid/',
    }),
  });
});

test('with no node healthy, every node is still tried', async () => {
  const service = fixture({ exists: down }, { exists: async () => true }, []);
  await service.probe();
  assert({
    given: 'probes failing for both nodes',
    should: 'still ask, since a probe can be wrong',
    actual: await service.exists('room'),
    expected: true,
  });
});

test('a node whose public route fails is not offered, even with its API up', async () => {
  const service = createMediaNodes({
    nodes: [
      { url: 'http://a.private', publicUrl: 'wss://a.public' },
      { url: 'http://b.private', publicUrl: 'wss://b.public' },
    ],
    apiKey: 'key',
    apiSecret: 'secret',
    services: [{} as Service, {} as Service],
    fetch: async (url) => {
      if (url.includes('a.public')) throw new Error('refused');
      return new Response('OK');
    },
  });
  await service.probe();
  assert({
    given: 'node A answering on its API but not its public route',
    should: 'send every room to B',
    actual: ['room-1', 'room-2', 'room-3'].map(
      (room) => service.urlsFor(room).publicUrl,
    ),
    expected: Array(3).fill('wss://b.public'),
  });
});

test('a read reaches a node the last probe called down, once the healthy ones fault', async () => {
  const service = fixture({ exists: down }, { exists: async () => true }, [
    'a.invalid',
  ]);
  await service.probe();
  assert({
    given: 'A healthy by the probe but faulting, and B called down but back',
    should: 'still answer from B',
    actual: await service.exists('room'),
    expected: true,
  });
});
