import { isIP } from 'node:net';

/** The networks a client's magic-link requests are also counted per (AUTH-3.10). */
export type NetworkScope = 'ipv6_56' | 'ipv6_48' | 'ipv4_24';

export type ClientNetwork = {
  readonly scope: NetworkScope;
  /** The network in CIDR form: never the client's own address. */
  readonly network: string;
};

/** An IPv6 address's eight groups, each four lowercase hex digits. */
const ipv6Groups = (address: string): string[] => {
  const [left = '', right] = address.toLowerCase().split('::');
  const head = left ? left.split(':') : [];
  const tail = right ? right.split(':') : [];
  const zeros = Array.from(
    { length: right === undefined ? 0 : 8 - head.length - tail.length },
    () => '0',
  );
  return [...head, ...zeros, ...tail].map((group) => group.padStart(4, '0'));
};

/**
 * The networks a trusted client address belongs to, for the aggregate
 * magic-link buckets: an IPv6 client's /56 and /48, and an IPv4 client's
 * /24. The address is what Better Auth's `getIP` resolved from the header
 * the ingress stamps (`client-ip.ts`), so for IPv6 it is already the /64,
 * expanded; any IPv6 form is accepted. No client, or a value that is not an
 * IP address, is in no network, so only the per-client buckets apply.
 */
export function clientNetworks(
  client: string | null,
): readonly ClientNetwork[] {
  if (client === null) return [];
  const family = isIP(client);
  if (family === 4) {
    const [a, b, c] = client.split('.');
    return [{ scope: 'ipv4_24', network: `${a}.${b}.${c}.0/24` }];
  }
  if (family !== 6) return [];
  const [g0, g1, g2, g3 = '0000'] = ipv6Groups(client);
  return [
    { scope: 'ipv6_56', network: `${g0}:${g1}:${g2}:${g3.slice(0, 2)}00::/56` },
    { scope: 'ipv6_48', network: `${g0}:${g1}:${g2}::/48` },
  ];
}
