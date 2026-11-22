import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { HostedRoom } from '@daisy/protocol/hosted-rooms';
import { HostedRooms } from './hosted-rooms';

setupRitewayBun();

const id = (c: string) => c.repeat(24);
const room = (over: Partial<HostedRoom>): HostedRoom => ({
  id: id('a'),
  title: 'Friday practice',
  status: 'assembling',
  seated: false,
  ...over,
});

describe('HostedRooms (TAB-6.16)', () => {
  test('the list links back to each Room the member hosts without a seat', () => {
    const html = renderToStaticMarkup(
      <HostedRooms
        rooms={[room({}), room({ id: id('b'), title: 'Seated', seated: true })]}
      />,
    );
    assert({
      given: 'a hosted Room without a seat and one the host sits in',
      should:
        'title the list and link only to the first, with its state; the seated one is the active-Room bar’s',
      actual: [
        html.includes('Rooms you host'),
        html.includes(`href="/rooms/${id('a')}"`),
        html.includes('Setting up'),
        html.includes(`href="/rooms/${id('b')}"`),
      ],
      expected: [true, true, true, false],
    });
  });

  test('no hosted Room, or only seated ones, shows nothing', () => {
    assert({
      given: 'no hosted Room, then only a seated one',
      should: 'render no list',
      actual: [
        renderToStaticMarkup(<HostedRooms rooms={[]} />),
        renderToStaticMarkup(<HostedRooms rooms={[room({ seated: true })]} />),
      ],
      expected: ['', ''],
    });
  });
});
