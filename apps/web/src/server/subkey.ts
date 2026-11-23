import { sha3Hex } from '@daisy/digest';

/**
 * A subkey derived once from a secret, domain-separated by a fixed label per
 * use, so a leaked subkey can never double as a leaked secret or as another
 * use's subkey. Shared by mail recipients, client addresses and link tokens.
 */
export const deriveSubkey = (secret: string, label: string): string =>
  sha3Hex(`${secret}\0${label}`);
