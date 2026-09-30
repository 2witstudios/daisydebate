import { isIP } from 'node:net';

/** The networks a client's magic-link requests are also counted per (AUTH-3.10). */
export type NetworkScope = 'ipv6_56' | 'ipv6_48' | 'ipv4_24';

export type ClientNetwork = {
  readonly scope: NetworkScope;
  /** The network in CIDR form: never the client's own address. */
  readonly network: string;
};

/**
 * An IPv6 address's eight groups, each four lowercase hex digits, with an
 * embedded IPv4 tail (`::ffff:1.2.3.4`) turned into its two groups.
 */
const ipv6Groups = (address: string): string[] => {
  const lower = address.toLowerCase();
  const dotted = lower.lastIndexOf(':');
  const tail = lower.slice(dotted + 1);
  const hex =
    isIP(tail) === 4
      ? (() => {
          const [a = 0, b = 0, c = 0, d = 0] = tail.split('.').map(Number);
          const group = (high: number, low: number) =>
            ((high << 8) | low).toString(16);
          return `${lower.slice(0, dotted + 1)}${group(a, b)}:${group(c, d)}`;
        })()
      : lower;
  const [left = '', right] = hex.split('::');
  const head = left ? left.split(':') : [];
  const rest = right ? right.split(':') : [];
  const zeros = Array.from(
    { length: right === undefined ? 0 : 8 - head.length - rest.length },
    () => '0',
  );
  return [...head, ...zeros, ...rest].map((group) => group.padStart(4, '0'));
};

/** The IPv4 address an IPv4-mapped IPv6 address (`::ffff:0:0/96`) carries. */
const mappedIPv4 = (groups: readonly string[]): string | undefined => {
  if (groups.slice(0, 5).some((group) => group !== '0000')) return undefined;
  if (groups[5] !== 'ffff') return undefined;
  const octets = [groups[6] ?? '0000', groups[7] ?? '0000'].flatMap((group) => [
    Number.parseInt(group.slice(0, 2), 16),
    Number.parseInt(group.slice(2), 16),
  ]);
  return octets.join('.');
};

const ipv4Network = (address: string): ClientNetwork => {
  const [a, b, c] = address.split('.');
  return { scope: 'ipv4_24', network: `${a}.${b}.${c}.0/24` };
};

/**
 * The networks a trusted client address belongs to, for the aggregate
 * magic-link buckets: an IPv6 client's /56 and /48, and an IPv4 client's
 * /24. The address is what Better Auth's `getIP` resolved from the header
 * the ingress stamps (`client-ip.ts`), so for IPv6 it is already the /64,
 * expanded; any IPv6 form is accepted. An IPv4-mapped IPv6 address is in
 * its IPv4 /24. No client, the unspecified or loopback IPv6 address, or a
 * value that is not an IP address, is in no network, so only the
 * per-client buckets apply.
 */
export function clientNetworks(
  client: string | null,
): readonly ClientNetwork[] {
  if (client === null) return [];
  const family = isIP(client);
  if (family === 4) return [ipv4Network(client)];
  if (family !== 6) return [];
  const groups = ipv6Groups(client);
  // An IPv4-mapped address is an IPv4 client: its /24, never an IPv6 network
  // every mapped client would share (AUTH-3.10.1).
  const mapped = mappedIPv4(groups);
  if (mapped !== undefined) return [ipv4Network(mapped)];
  // The unspecified (::) and loopback (::1) addresses are never a real client
  // through the ingress; they get no network rather than one shared bucket.
  if (groups.slice(0, 7).every((group) => group === '0000')) return [];
  const [g0, g1, g2, g3 = '0000'] = groups;
  return [
    { scope: 'ipv6_56', network: `${g0}:${g1}:${g2}:${g3.slice(0, 2)}00::/56` },
    { scope: 'ipv6_48', network: `${g0}:${g1}:${g2}::/48` },
  ];
}
