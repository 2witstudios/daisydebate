import { assert, setupRitewayBun, test } from 'riteway/bun';
import { CLIENT_IP_HEADER } from '@daisy/ingress/client-ip';
import { currentFairnessKey, fairnessKeyOf, withFairnessKey } from './fairness';

setupRitewayBun();
const from = (client?: string) =>
  new Request('http://localhost/', {
    headers: client ? { [CLIENT_IP_HEADER]: client } : {},
  });

test('a request is keyed by its client network and the key follows its async work', async () => {
  const seen = await withFairnessKey(from('2001:db8:1:2::9'), async () => {
    await Promise.resolve();
    return currentFairnessKey();
  });
  assert({
    given:
      'IPv6, IPv4 and missing client addresses, and work inside a keyed request',
    should:
      'key by the /48 or /24 network, share one key without an address, and keep the key across awaits',
    actual: {
      v6: fairnessKeyOf(from('2001:db8:1:2::9')),
      sameV6: fairnessKeyOf(from('2001:db8:1:ffff::1')),
      v4: fairnessKeyOf(from('203.0.113.7')),
      none: fairnessKeyOf(from()),
      seen,
      outside: currentFairnessKey(),
    },
    expected: {
      v6: '2001:0db8:0001::/48',
      sameV6: '2001:0db8:0001::/48',
      v4: '203.0.113.0/24',
      none: '',
      seen: '2001:0db8:0001::/48',
      outside: undefined,
    },
  });
});
