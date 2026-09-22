import type { Principal } from './index';

/** Facts about a durable session, verified by the injected reader. */
export type VerifiedSession = {
  readonly userId: string;
  readonly emailVerified: boolean;
  readonly username: string | null;
  /** UTC ISO instant. */
  readonly expiresAt: string;
};

/**
 * Reads the durable session named by the request's cookies. The adapter owns
 * cookie signature checks and the database lookup; null means no live
 * session. It receives only the raw Cookie header.
 */
export type SessionReader = (cookie: string) => Promise<VerifiedSession | null>;

const anonymous = { kind: 'anonymous' } as const;

/**
 * Who is asking, and how far through onboarding: anonymous visitors, verified
 * accounts still choosing a username (`provisional`, no permission), and
 * accounts with a public identity (`member`).
 */
export type Identity =
  | { readonly state: 'anonymous'; readonly principal: Principal }
  | { readonly state: 'provisional'; readonly principal: Principal }
  | {
      readonly state: 'member';
      readonly username: string;
      readonly principal: Principal;
    };

const ANONYMOUS: Identity = { state: 'anonymous', principal: anonymous };

/**
 * Principal resolution from request cookies (ADR 0020, gate 2). Only the
 * cookie header enters; permissions derive from verified facts alone, so
 * request-supplied roles, permissions or identity fields cannot matter. An
 * unreadable store resolves anonymous: the gate fails closed.
 */
export async function resolveIdentity({
  cookie,
  readSession,
  now,
}: {
  readonly cookie: string | null;
  readonly readSession: SessionReader;
  readonly now: () => string;
}): Promise<Identity> {
  if (!cookie) return ANONYMOUS;
  let found: VerifiedSession | null;
  try {
    found = await readSession(cookie);
  } catch {
    return ANONYMOUS;
  }
  if (!found || found.emailVerified !== true) return ANONYMOUS;
  const expires = Date.parse(found.expiresAt);
  if (Number.isNaN(expires) || expires <= Date.parse(now())) return ANONYMOUS;
  const userId = found.userId;
  const username = found.username;
  return typeof username === 'string' && username !== ''
    ? {
        state: 'member',
        username,
        principal: { kind: 'user', userId, permissions: ['debate:create'] },
      }
    : {
        state: 'provisional',
        principal: { kind: 'user', userId, permissions: [] },
      };
}
