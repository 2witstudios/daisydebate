import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ingressPreferencesSafe, ingressReady } from './ingress-status';
setupRitewayBun();
test('ingressReady', () => {
  const origin = 'https://daisy-admin.tail51baf2.ts.net';
  assert({
    given: 'unregistered, wrong-name and matching running nodes',
    should: 'admit only the exact persistent identity',
    actual: [
      null,
      { BackendState: 'NeedsLogin' },
      {
        BackendState: 'Running',
        Self: { DNSName: 'daisy-admin-1.tail51baf2.ts.net.' },
      },
      {
        BackendState: 'Running',
        Self: { DNSName: 'daisy-admin.tail51baf2.ts.net.' },
      },
    ].map((value) => ingressReady(value, origin)),
    expected: [false, false, false, true],
  });
});
test('ingressPreferencesSafe', () => {
  const safe = {
    RunSSH: false,
    RouteAll: false,
    CorpDNS: false,
    ExitNodeID: '',
    ExitNodeIP: '',
    AdvertiseRoutes: null,
  };
  assert({
    given: 'SSH, DNS, exit or subnet settings or malformed preferences',
    should: 'refuse all rather than inherit network authority',
    actual: [
      safe,
      null,
      {},
      { ...safe, RunSSH: true },
      { ...safe, RouteAll: true },
      { ...safe, CorpDNS: true },
      { ...safe, ExitNodeID: 'node' },
      { ...safe, AdvertiseRoutes: ['0.0.0.0/0'] },
    ].map(ingressPreferencesSafe),
    expected: [true, false, false, false, false, false, false, false],
  });
});
