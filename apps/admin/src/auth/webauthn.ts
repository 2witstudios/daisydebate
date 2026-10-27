import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { z } from 'zod';
import { ADMIN_ORIGIN, ADMIN_RP_ID } from './origin';
import { toBase64Url } from './secrets';

/**
 * The two passkey ceremonies, fixed to the canonical origin and RP ID with
 * user verification required (ADR 0077). Verification failures of any kind
 * collapse to null: callers record one failure, never the library's text.
 */
export type CeremonyOrigin = { readonly origin: string; readonly rpId: string };
export const canonicalCeremony: CeremonyOrigin = {
  origin: ADMIN_ORIGIN,
  rpId: ADMIN_RP_ID,
};

export type StoredCredential = {
  readonly credentialId: string;
  readonly publicKey: string;
  readonly signCount: number;
  readonly transports: readonly string[];
};

const transportNames = new Set<string>([
  'ble',
  'cable',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
]);
const transportsOf = (values: readonly string[]) =>
  values.filter((value): value is AuthenticatorTransportFuture =>
    transportNames.has(value),
  );

export const registrationOptions = (input: {
  readonly operatorId: string;
  readonly displayName: string;
  readonly challenge: Uint8Array<ArrayBuffer>;
  readonly existing: readonly StoredCredential[];
}): Promise<PublicKeyCredentialCreationOptionsJSON> =>
  generateRegistrationOptions({
    rpName: 'Daisy admin',
    rpID: canonicalCeremony.rpId,
    userName: input.displayName,
    userID: new TextEncoder().encode(input.operatorId),
    challenge: input.challenge,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
    excludeCredentials: input.existing.map((credential) => ({
      id: credential.credentialId,
      transports: transportsOf(credential.transports),
    })),
  });

export const authenticationOptions = (
  challenge: Uint8Array<ArrayBuffer>,
): Promise<PublicKeyCredentialRequestOptionsJSON> =>
  generateAuthenticationOptions({
    rpID: canonicalCeremony.rpId,
    challenge,
    userVerification: 'required',
  });

const clientData = z.object({ challenge: z.string().min(1).max(128) });

/** The challenge a response answers, read from its clientDataJSON. */
export function responseChallenge(clientDataJSON: string): string | null {
  try {
    const parsed = clientData.safeParse(
      JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8')),
    );
    return parsed.success ? parsed.data.challenge : null;
  } catch {
    return null;
  }
}

export type RegisteredCredential = StoredCredential & {
  readonly backedUp: boolean;
};

export async function verifyRegistration(input: {
  readonly response: RegistrationResponseJSON;
  readonly challenge: string;
  readonly ceremony: CeremonyOrigin;
}): Promise<RegisteredCredential | null> {
  try {
    const result = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: input.challenge,
      expectedOrigin: input.ceremony.origin,
      expectedRPID: input.ceremony.rpId,
      requireUserVerification: true,
    });
    if (!result.verified || !result.registrationInfo.userVerified) return null;
    const { credential, credentialBackedUp } = result.registrationInfo;
    return {
      credentialId: credential.id,
      publicKey: toBase64Url(credential.publicKey),
      signCount: credential.counter,
      transports: credential.transports ?? [],
      backedUp: credentialBackedUp,
    };
  } catch {
    return null;
  }
}

export async function verifyAuthentication(input: {
  readonly response: AuthenticationResponseJSON;
  readonly challenge: string;
  readonly credential: StoredCredential;
  readonly ceremony: CeremonyOrigin;
}): Promise<{ readonly counter: number; readonly backedUp: boolean } | null> {
  try {
    const result = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: input.challenge,
      expectedOrigin: input.ceremony.origin,
      expectedRPID: input.ceremony.rpId,
      requireUserVerification: true,
      credential: {
        id: input.credential.credentialId,
        publicKey: new Uint8Array(
          Buffer.from(input.credential.publicKey, 'base64url'),
        ),
        // The counter rule is ours (counter.ts), applied after verification.
        counter: 0,
        transports: transportsOf(input.credential.transports),
      },
    });
    if (!result.verified || !result.authenticationInfo.userVerified)
      return null;
    return {
      counter: result.authenticationInfo.newCounter,
      backedUp: result.authenticationInfo.credentialBackedUp,
    };
  } catch {
    return null;
  }
}
