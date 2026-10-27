import type { OperatorCrypto } from '@daisy/auth/operator-signature';
import { sha3 } from '../../auth/secrets';

/**
 * The operator signature's hash primitives (ADR 0079) at the admin edge,
 * on Bun's own hasher like every other admin digest. The participant app
 * verifies with node:crypto; the parity test holds the two byte-identical.
 */
export const bunOperatorCrypto: OperatorCrypto = {
  hmacSha256: (key, text) =>
    new Bun.CryptoHasher('sha256', key).update(text).digest('base64url'),
  sha256Hex: (bytes) =>
    new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
  sha3Hex: sha3,
};
