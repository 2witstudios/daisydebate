import { createHash } from 'node:crypto';
import { z } from 'zod';
import { liveHref } from '../watch/routes';

/**
 * What decides whether an audience may reach a Round, as a named, read-only
 * input: the visibility frozen on it and the hash of its current link.
 */
export type AudienceLinkFacts = {
  readonly visibility: 'public' | 'unlisted' | 'private' | null;
  readonly audienceLinkHash: string | null;
};

const TOKEN_BYTES = 32;
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** A week: long enough to come back to a Round, short enough to end by itself. */
const COOKIE_SECONDS = 604_800;

/** A CSPRNG secret, never a cuid2 id (DEC-302). Only its hash is stored. */
export const newAudienceLinkToken = (
  random: (bytes: number) => Uint8Array = (bytes) =>
    crypto.getRandomValues(new Uint8Array(bytes)),
): string => Buffer.from(random(TOKEN_BYTES)).toString('base64url');

export const audienceLinkHash = (token: string): string =>
  createHash('sha3-256').update(token).digest('hex');

export const isAudienceLinkToken = (value: unknown): value is string =>
  tokenSchema.safeParse(value).success;

/**
 * The address a host shares. It opens the Round by moving the token into a
 * cookie, so this is the one request that ever carries it in a URL.
 */
export const audienceLinkHref = (roundId: string, token: string): string =>
  `${liveHref(roundId)}/link?token=${token}`;

/** Where a host issues and replaces a Round's link. */
export const audienceLinkPageHref = (roundId: string): string =>
  `/rounds/${encodeURIComponent(roundId)}/audience-link`;

/** The host's way to that page: only with a link to share and Watch open. */
export const shareLinkHref = (
  hosted: unknown,
  roundId: string,
  watchOpen: boolean,
): string | null =>
  hosted && watchOpen ? audienceLinkPageHref(roundId) : null;

/**
 * The one rule for every audience read: a public Round is open to anyone, and an
 * unlisted one to the holder of its current link. Compared as digests, so the
 * comparison reveals nothing about the secret. Default deny.
 */
export const audienceAdmits = (
  facts: AudienceLinkFacts,
  presentedHash: string | null,
): boolean => {
  if (facts.visibility === 'public') return true;
  return (
    facts.visibility === 'unlisted' &&
    presentedHash !== null &&
    facts.audienceLinkHash === presentedHash
  );
};

/**
 * The rule for a request that names an account: someone in the Round's live room
 * reaches its audience surfaces by being there, and anyone else by the link.
 */
export const requestAdmits =
  (request: Request, roundId: string) =>
  (admission: AudienceLinkFacts & { readonly inLiveRoom: boolean }): boolean =>
    admission.inLiveRoom ||
    audienceAdmits(
      admission,
      presentedLinkHash(request.headers.get('cookie'), roundId),
    );

const cookieName = (roundId: string) => `daisy_audience_link_${roundId}`;

/** Script never reads it, and it leaves in no URL, referrer or cache key. */
export const audienceLinkCookie = (
  roundId: string,
  token: string,
  { secure }: { readonly secure: boolean },
): string =>
  `${cookieName(roundId)}=${token}; Path=/; Max-Age=${COOKIE_SECONDS}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

/** The hash of the link this request holds for this Round, or null. */
export const presentedLinkHash = (
  cookieHeader: string | null,
  roundId: string,
): string | null => {
  const prefix = `${cookieName(roundId)}=`;
  const value = cookieHeader
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  return isAudienceLinkToken(value) ? audienceLinkHash(value) : null;
};
