import type { BetaAccessState } from '@daisy/protocol';
import type { Principal } from './index';
import { ageAdmitted, participantAccess } from './authorization';
import type { AgeBand } from './age-band';

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

/** An account's participation facts (ADR 0075): its beta state and age band now. */
export type Participation = {
  readonly betaState: BetaAccessState | null;
  readonly ageBand: AgeBand | null;
};

const anonymous = { kind: 'anonymous' } as const;

/**
 * Who is asking, and how far through onboarding: anonymous visitors, verified
 * accounts still choosing a username (`provisional`, no actor), accounts
 * with a public identity still waiting for beta access (`waitlisted`,
 * pending or revoked, ADR 0075), and approved accounts (`member`).
 */
type AnonymousPrincipal = Extract<Principal, { kind: 'anonymous' }>;
type UserPrincipal = Extract<Principal, { kind: 'user' }>;

export type Identity =
  | { readonly state: 'anonymous'; readonly principal: AnonymousPrincipal }
  /** The session store could not be read: fail closed, but not as signed out. */
  | { readonly state: 'unavailable'; readonly principal: AnonymousPrincipal }
  | { readonly state: 'provisional'; readonly principal: UserPrincipal }
  | {
      readonly state: 'waitlisted';
      readonly username: string;
      /**
       * Why it waits: `pending` approval, `revoked` access, or
       * `age-required` (no durable age record at the floor yet).
       */
      readonly reason: 'pending' | 'revoked' | 'age-required';
      readonly principal: UserPrincipal;
    }
  | {
      readonly state: 'member';
      readonly username: string;
      readonly principal: UserPrincipal;
    };

const ANONYMOUS: Identity = { state: 'anonymous', principal: anonymous };
const UNAVAILABLE: Identity = { state: 'unavailable', principal: anonymous };

/**
 * Principal resolution from request cookies (ADR 0020, gate 2). Only the
 * cookie header enters; identity derives from verified facts alone, so
 * request-supplied roles, permissions or identity fields cannot matter. An
 * unreadable store resolves `unavailable`: no authority (the gate fails
 * closed) and distinguishable from a signed-out visitor, so callers can
 * answer 503 and report the outage instead of sending members to sign-in.
 */
export async function resolveIdentity({
  cookie,
  readSession,
  readActor,
  readParticipation,
  now,
}: {
  readonly cookie: string | null;
  readonly readSession: SessionReader;
  readonly readActor: (
    userId: string,
  ) => Promise<{ readonly id: string; readonly userId: string | null } | null>;
  /** The account's beta access state and age band from the canonical account fact (ADR 0075). */
  readonly readParticipation: (userId: string) => Promise<Participation>;
  readonly now: () => string;
}): Promise<Identity> {
  if (!cookie) return ANONYMOUS;
  let found: VerifiedSession | null;
  try {
    found = await readSession(cookie);
  } catch {
    return UNAVAILABLE;
  }
  if (!found || found.emailVerified !== true) return ANONYMOUS;
  const instant = Date.parse(now());
  if (!Number.isFinite(instant)) return UNAVAILABLE;
  const expires = Date.parse(found.expiresAt);
  if (Number.isNaN(expires) || expires <= instant) return ANONYMOUS;
  return identityFromSession(found, readActor, readParticipation);
}

async function identityFromSession(
  found: VerifiedSession,
  readActor: Parameters<typeof resolveIdentity>[0]['readActor'],
  readParticipation: Parameters<typeof resolveIdentity>[0]['readParticipation'],
): Promise<Identity> {
  // The reader is an adapter boundary: only a non-empty string username
  // makes a member, whatever else the lookup returned.
  const { userId, username } = found;
  if (typeof userId !== 'string' || !userId) return UNAVAILABLE;
  if (typeof username !== 'string' || username === '')
    return {
      state: 'provisional',
      principal: { kind: 'user', userId, actorId: null },
    };
  try {
    const actor = await readActor(userId);
    if (
      !actor ||
      actor.userId !== userId ||
      typeof actor.id !== 'string' ||
      !actor.id
    )
      return UNAVAILABLE;
    return participation(
      username,
      { kind: 'user', userId, actorId: actor.id },
      await readParticipation(userId),
    );
  } catch {
    return UNAVAILABLE;
  }
}

/**
 * A claimed account's identity from its participation facts (ADR 0075):
 * a member with participant access, otherwise waitlisted with its reason.
 * No beta row or no admitted age record is never access.
 */
function participation(
  username: string,
  principal: UserPrincipal,
  facts: {
    readonly betaState: BetaAccessState | null;
    readonly ageBand: AgeBand | null;
  },
): Identity {
  const { betaState, ageBand } = facts;
  if (participantAccess({ beta: betaState && { state: betaState }, ageBand }))
    return { state: 'member', username, principal };
  const reason =
    betaState === 'revoked'
      ? 'revoked'
      : ageAdmitted(ageBand)
        ? 'pending'
        : 'age-required';
  return { state: 'waitlisted', username, reason, principal };
}
