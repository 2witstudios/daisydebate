import { createHash, createHmac } from 'node:crypto';
import type { OperatorCrypto } from '@daisy/auth/operator-signature';

/** The operator signature's hash primitives (ADR 0079), at the app edge. */
export const nodeOperatorCrypto: OperatorCrypto = {
  hmacSha256: (key, text) =>
    createHmac('sha256', key).update(text, 'utf8').digest('base64url'),
  sha256Hex: (bytes) => createHash('sha256').update(bytes).digest('hex'),
  sha3Hex: (text) => createHash('sha3-256').update(text, 'utf8').digest('hex'),
};

export const decodeBase64url = (text: string): Uint8Array =>
  new Uint8Array(Buffer.from(text, 'base64url'));
