import { assert, setupRitewayBun, test } from 'riteway/bun';
import { drillBrowserPorts } from './local-ports';

setupRitewayBun();

test('drillBrowserPorts', () => {
  assert({
    given: 'rented nodes with public addresses',
    should: 'forward nothing extra and leave the UDP forward alone',
    actual: drillBrowserPorts({
      DRILL_NODES: JSON.stringify([{ media: '66.51.125.26' }]),
    }),
    expected: { extraPorts: [] },
  });
  assert({
    given: 'local nodes behind edges',
    should: 'forward each edge and each UDP port',
    actual: drillBrowserPorts({
      DRILL_NODES: JSON.stringify([
        { media: '127.0.0.1:18882' },
        { media: '127.0.0.1:18892' },
      ]),
      ROOM_LAUNCH_MEDIA_EDGES: JSON.stringify([
        { port: 13034, upstreamPort: 18880 },
        { port: 13037, upstreamPort: 18890 },
      ]),
    }),
    expected: { extraPorts: [13034, 13037], udpPorts: [18882, 18892] },
  });
});
