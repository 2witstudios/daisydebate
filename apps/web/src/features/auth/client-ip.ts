import { createHash } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import { deriveSubkey } from './recipient-key';

/** Internal header the ingress stamps; Better Auth reads only this one. */
export const CLIENT_IP_HEADER = 'x-daisy-client-ip';
/** Internal header the ingress stamps: the keyed hash request logs carry. */
export const CLIENT_ID_HASH_HEADER = 'x-daisy-client-id-hash';

export const deriveClientIdSubkey = (secret: string): string =>
  deriveSubkey(secret, 'client-id-hash');

/**
 * Correlates one client across log lines without the address. Keyed by a
 * subkey of the app secret, because a plain hash of an IPv4 address is
 * reversed by hashing all 2^32 of them.
 */
export const clientIdHash = (subkey: string, client: string): string =>
  createHash('sha3-256').update(`${subkey}\0${client}`).digest('hex');

const unmap = (address: string) =>
  address.toLowerCase().startsWith('::ffff:') && isIP(address.slice(7)) === 4
    ? address.slice(7)
    : address;

function blockList(entries: readonly string[]) {
  const list = new BlockList();
  for (const entry of entries) {
    const [address = '', prefix] = entry.split('/');
    const family = isIP(address) === 6 ? 'ipv6' : 'ipv4';
    if (prefix === undefined) list.addAddress(address, family);
    else list.addSubnet(address, Number(prefix), family);
  }
  return list;
}

const isTrusted = (list: BlockList, address: string) => {
  const family = isIP(address);
  return family !== 0 && list.check(address, family === 6 ? 'ipv6' : 'ipv4');
};

/**
 * The client is the socket peer unless the peer is a configured trusted
 * ingress hop; only then is the forwarded chain read, from the right, so a
 * caller-forged left-most value never selects the rate-limit identity.
 */
export function resolveClientIp(input: {
  readonly peer: string | undefined;
  readonly forwardedFor: string | null | undefined;
  readonly trustedProxies: readonly string[];
}): string | null {
  if (!input.peer) return null;
  const peer = unmap(input.peer);
  if (isIP(peer) === 0) return null;
  if (input.trustedProxies.length === 0) return peer;
  const trusted = blockList(input.trustedProxies);
  if (!isTrusted(trusted, peer)) return peer;
  const chain = (input.forwardedFor ?? '')
    .split(',')
    .map((hop) => unmap(hop.trim()))
    .filter(Boolean);
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const hop = chain[index] ?? '';
    if (isIP(hop) === 0) return peer;
    if (!isTrusted(trusted, hop)) return hop;
  }
  return peer;
}

type IngressRequest = {
  readonly socket: { readonly remoteAddress?: string | undefined };
  readonly headers: Record<string, string | string[] | undefined>;
};

/**
 * Deployment ingress: replaces any caller-supplied identity and hash
 * headers with the resolved ones (or removes them) before the request
 * reaches application code.
 */
export function stampClientIdentity(
  request: IngressRequest,
  trustedProxies: readonly string[],
  clientIdSubkey: string,
): void {
  const forwarded = request.headers['x-forwarded-for'];
  const client = resolveClientIp({
    peer: request.socket.remoteAddress,
    forwardedFor: Array.isArray(forwarded) ? forwarded.join(',') : forwarded,
    trustedProxies,
  });
  if (client) {
    request.headers[CLIENT_IP_HEADER] = client;
    request.headers[CLIENT_ID_HASH_HEADER] = clientIdHash(
      clientIdSubkey,
      client,
    );
  } else {
    delete request.headers[CLIENT_IP_HEADER];
    delete request.headers[CLIENT_ID_HASH_HEADER];
  }
}
