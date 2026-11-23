import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { HostedRoom } from '@daisy/protocol/hosted-rooms';
import { renderAccessible } from '../../test-support/rendered/accessible';
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
    const view = renderAccessible(
      <HostedRooms
        rooms={[room({}), room({ id: id('b'), title: 'Seated', seated: true })]}
      />,
    );
    assert({
      given: 'a hosted Room without a seat and one the host sits in',
      should:
        'title the list and link only to the first, with its state; the seated one is the active-Room bar’s',
      actual: [
        view.has('heading', 'Rooms you host', { level: 2 }),
        view.all('link').map((link) => link.getAttribute('href')),
        view.has('link', 'Friday practice'),
        view.text('listitem').includes('Setting up'),
      ],
      expected: [true, [`/rooms/${id('a')}`], true, true],
    });
  });

  test('no hosted Room, or only seated ones, shows nothing', () => {
    assert({
      given: 'no hosted Room, then only a seated one',
      should: 'render no list',
      actual: [
        renderAccessible(<HostedRooms rooms={[]} />).textContent(),
        renderAccessible(
          <HostedRooms rooms={[room({ seated: true })]} />,
        ).textContent(),
      ],
      expected: ['', ''],
    });
  });
});
