import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { ConnectionStore } from '../realtime/connection-types';
import { sharedConnections } from './shared-connection';

setupRitewayBun();

test('resource syncs on one page share one realtime socket per URL', () => {
  const created: string[] = [];
  let closed = 0;
  const acquire = sharedConnections((url) => {
    created.push(url);
    return { close: () => void (closed += 1) } as unknown as ConnectionStore;
  });
  const room = acquire('wss://rt.example/ws');
  const transcript = acquire('wss://rt.example/ws');
  const other = acquire('wss://other.example/ws');
  transcript.close();
  transcript.close();
  const afterOneRelease = closed;
  room.close();
  const afterBoth = closed;
  acquire('wss://rt.example/ws');
  assert({
    given:
      'the live Round and its transcript on one URL, another URL, a repeated release, then a fresh acquire',
    should:
      'open one socket per URL, keep it while any holder remains, close it with the last holder, and reopen on the next acquire',
    actual: { created, afterOneRelease, afterBoth, stillOpen: other !== null },
    expected: {
      created: [
        'wss://rt.example/ws',
        'wss://other.example/ws',
        'wss://rt.example/ws',
      ],
      afterOneRelease: 0,
      afterBoth: 1,
      stillOpen: true,
    },
  });
});
