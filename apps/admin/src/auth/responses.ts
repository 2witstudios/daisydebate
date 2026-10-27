import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { z } from 'zod';

/**
 * The browser's ceremony results are untrusted: bounded shapes first, then
 * the library's cryptographic verification.
 */
const b64 = z.string().regex(/^[A-Za-z0-9_-]{1,4096}$/);
const envelope = {
  id: b64,
  rawId: b64,
  type: z.literal('public-key'),
  clientExtensionResults: z.record(z.string(), z.unknown()),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
};
const registration = z.object({
  ...envelope,
  response: z.object({
    clientDataJSON: b64,
    attestationObject: b64,
    transports: z.array(z.string().max(32)).max(8).optional(),
  }),
});
const authentication = z.object({
  ...envelope,
  response: z.object({
    clientDataJSON: b64,
    authenticatorData: b64,
    signature: b64,
    userHandle: b64.optional(),
  }),
});

export const parseRegistration = (
  value: unknown,
): RegistrationResponseJSON | null => {
  const parsed = registration.safeParse(value);
  return parsed.success ? (parsed.data as RegistrationResponseJSON) : null;
};

export const parseAuthentication = (
  value: unknown,
): AuthenticationResponseJSON | null => {
  const parsed = authentication.safeParse(value);
  return parsed.success ? (parsed.data as AuthenticationResponseJSON) : null;
};
