import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { RoundRoomReconnecting } from './round-room-reconnecting';

setupRitewayBun();

test('the temporary state recovers by itself and claims nothing about the Round', () => {
  const html = renderToString(<RoundRoomReconnecting />);
  assert({
    given: 'a Round room whose read was temporarily refused',
    should:
      'refresh with no script, announce it, offer a link and show no control',
    actual: {
      refresh: html.includes('http-equiv="refresh" content="2"'),
      status: html.includes('role="status"'),
      link: html.includes('href=""'),
      controls: html.includes('<button') || html.includes('<form'),
    },
    expected: { refresh: true, status: true, link: true, controls: false },
  });
});
