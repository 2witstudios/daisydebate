import { createHash } from 'node:crypto';
import {
  CLIENT_IP_HEADER,
  FLY_CLIENT_IP_HEADER,
  resolveClientIp,
} from '@daisy/ingress/client-ip';
import { deriveSubkey } from '../mail/recipient-key';

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
  const flyClientIpHeader = request.headers[FLY_CLIENT_IP_HEADER];
  const client = resolveClientIp({
    peer: request.socket.remoteAddress,
    forwardedFor: Array.isArray(forwarded) ? forwarded.join(',') : forwarded,
    // Fly never duplicates this header; an array here is tampering, not a
    // value to salvage, so only a plain string is honored.
    flyClientIp:
      typeof flyClientIpHeader === 'string' ? flyClientIpHeader : undefined,
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
