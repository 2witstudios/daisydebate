import { assert, setupRitewayBun, test } from 'riteway/bun';
import { changesIn, heldStillMs, hostNetworkShape } from './host-network';

setupRitewayBun();

const before = hostNetworkShape({
  links: { eth0: 'up', 'br-a1': 'up' },
  addresses: { eth0: [{ family: 'IPv4', address: '10.1.0.4' }] },
});
const vethUp = hostNetworkShape({
  links: { eth0: 'up', 'br-a1': 'up', veth9: 'up' },
  addresses: { eth0: [{ family: 'IPv4', address: '10.1.0.4' }] },
});
const vethAddressed = hostNetworkShape({
  links: { eth0: 'up', 'br-a1': 'up', veth9: 'up' },
  addresses: {
    eth0: [{ family: 'IPv4', address: '10.1.0.4' }],
    veth9: [{ family: 'IPv6', address: 'fe80::1' }],
  },
});

test('hostNetworkShape', () => {
  assert({
    given: 'the same links and addresses listed in another order',
    should: 'read as the same shape',
    actual: hostNetworkShape({
      links: { 'br-a1': 'up', eth0: 'up' },
      addresses: { eth0: [{ family: 'IPv4', address: '10.1.0.4' }] },
    }),
    expected: before,
  });
  assert({
    given: 'a restarted node adding a link, then its address',
    should: 'read as two changes',
    actual: [before === vethUp, vethUp === vethAddressed],
    expected: [false, false],
  });
});

test('heldStillMs', () => {
  assert({
    given: 'no reads',
    should: 'have held for nothing',
    actual: heldStillMs([]),
    expected: 0,
  });
  assert({
    given: 'an address arriving at 2 s, read until 7 s',
    should: 'have held since the address arrived',
    actual: heldStillMs([
      { atMs: 0, shape: vethUp },
      { atMs: 1000, shape: vethUp },
      { atMs: 2000, shape: vethAddressed },
      { atMs: 7000, shape: vethAddressed },
    ]),
    expected: 5000,
  });
  assert({
    given: 'a shape that changed back to an earlier one',
    should: 'count only its latest run',
    actual: heldStillMs([
      { atMs: 0, shape: before },
      { atMs: 1000, shape: vethUp },
      { atMs: 2000, shape: before },
      { atMs: 2500, shape: before },
    ]),
    expected: 500,
  });
});

test('changesIn', () => {
  assert({
    given: 'a link and then its address',
    should: 'count two changes',
    actual: changesIn([
      { atMs: 0, shape: before },
      { atMs: 500, shape: vethUp },
      { atMs: 1000, shape: vethUp },
      { atMs: 1500, shape: vethAddressed },
    ]),
    expected: 2,
  });
});
