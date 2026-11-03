import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderLiveKitNode } from './livekit-node-config';

setupRitewayBun();

const base = await Bun.file(
  new URL('../fly.livekit.toml', import.meta.url),
).text();

test('a node is the committed config with its own app, address and size', () => {
  const node = renderLiveKitNode(base, {
    app: 'daisy-node-a',
    nodeIp: '203.0.113.7',
    size: 'performance-1x',
  });
  assert({
    given: 'one node',
    should: 'change only what is its own, and let the size set the memory',
    actual: [
      node.includes('app = "daisy-node-a"'),
      node.includes('LIVEKIT_NODE_IP = "203.0.113.7"'),
      node.includes('size = "performance-1x"'),
      /^\s*memory =/m.test(node),
      node.includes('daisy-debate-staging-livekit"\n'),
      node.includes('protocol = "udp"'),
    ],
    expected: [true, true, true, false, false, true],
  });
});

test('a bad node refuses rather than writing a wrong config', () => {
  const refused = (node: Parameters<typeof renderLiveKitNode>[1]) => {
    try {
      renderLiveKitNode(base, node);
      return 'accepted';
    } catch (error) {
      return (error as Error).message;
    }
  };
  assert({
    given: 'an unsafe app name and a malformed address',
    should: 'refuse both',
    actual: [
      refused({ app: 'a b', nodeIp: '203.0.113.7', size: 'performance-1x' }),
      refused({ app: 'a', nodeIp: 'nope', size: 'performance-1x' }),
      refused({ app: 'a', nodeIp: '999.1.1.1', size: 'performance-1x' }),
      refused({ app: 'a', nodeIp: '203.0.113.7', size: 'x"\ny' }),
      refused({
        app: 'a',
        nodeIp: '203.0.113.7',
        size: 'performance-1x',
        memory: '$&',
      }),
    ],
    expected: [
      'Invalid app name',
      'Invalid node address',
      'Invalid node address',
      'Invalid machine size',
      'Invalid machine memory',
    ],
  });
});
