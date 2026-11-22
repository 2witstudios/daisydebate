import { instantMs } from '@daisy/clock';
import { z } from 'zod';
import { normalizeEmail } from './email';

/**
 * Media releases (ADR 0151, amended by ADR 0161): a minor's Rounds are viewed
 * as anyone's are, but their content may not be reused (clipped, downloaded,
 * streamed on) until a parent or guardian signs a release, or a club that
 * already holds one confirms it on Daisy. A release is a durable, revocable
 * record of one scope for one minor. These rules are pure and
 * total: the instant is injected, and a refusal leaves the state unchanged.
 */

/**
 * What a release allows: `publish` (the stored name, kept) is the reuse
 * licence (clipping, download and reuse); paid ads is opted into separately.
 */
export const mediaReleaseScopes = ['publish', 'paid_ads'] as const;
export type MediaReleaseScope = (typeof mediaReleaseScopes)[number];

/** Who gave a release: a parent or guardian signing, or a club attesting. */
export const mediaReleaseSources = ['parent', 'club'] as const;

/** How a signer is related to the minor. */
export const guardianRelations = ['parent', 'legal_guardian'] as const;
export type GuardianRelation = (typeof guardianRelations)[number];

/** How an active release ended. */
export const releaseWithdrawers = [
  'parent',
  'club',
  'erasure',
  'superseded',
] as const;
type ReleaseWithdrawer = (typeof releaseWithdrawers)[number];

/** How a release request ended; an open request has none. */
export const releaseRequestOutcomes = [
  'signed',
  'declined',
  'not_me',
  'cancelled',
  'superseded',
  /** Closed after its expiry, when the minor asked again. */
  'expired',
  /** The address asked Daisy not to send it release requests. */
  'stopped',
] as const;
type ReleaseRequestOutcome = (typeof releaseRequestOutcomes)[number];

/** The two kinds of emailed link: sign a request, or manage a signed release. */
export const releaseLinkPurposes = ['sign', 'manage'] as const;
export type ReleaseLinkPurpose = (typeof releaseLinkPurposes)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

export const mediaReleasePolicy = {
  /** A request's links stop working 14 days after it was made. */
  requestTtlMs: 14 * DAY_MS,
  /** One reminder, 3 days after the request, if it is still open. */
  reminderAfterMs: 3 * DAY_MS,
  /** A manage link (in the signed copy) works for 30 days. */
  manageLinkTtlMs: 30 * DAY_MS,
  /** One request mails at most this many times, at most once in 10 minutes. */
  sendsPerRequest: 5,
  resendAfterMs: 10 * 60 * 1000,
  /** A minor starts at most this many requests a day. */
  requestsPerDay: 5,
  nameMaxLength: 120,
  roleMaxLength: 120,
  noteMaxLength: 1000,
} as const;

/** The release wording shown and recorded (the [COUNSEL] draft until counsel answers). */
export const mediaReleaseWording = {
  version: '2026-11-v2',
  label: '2026-11 v2',
} as const;

/**
 * The release wordings that license reuse (ADR 0161): clipping, download and
 * reuse by Daisy and others. A release signed at an earlier wording granted
 * publishing only and leaves the reuse fence in place.
 */
export const reuseLicensingWordings: readonly string[] = ['2026-11-v2'];

/** A parent's or guardian's signature. */
type ParentSignature = {
  readonly kind: 'parent';
  readonly name: string;
  readonly relation: GuardianRelation;
  /** Normalised; the address the request was sent to. */
  readonly email: string;
};

/** A club's confirmation that it holds a signed release. */
type ClubAttestation = {
  readonly kind: 'club';
  readonly organizationId: string;
  readonly organizationName: string;
  readonly attestedByUserId: string;
  readonly name: string;
  readonly role: string;
};

/** One scope of a release for one minor. */
export type MediaReleaseRecord = {
  readonly id: string;
  readonly subjectUserId: string;
  readonly scope: MediaReleaseScope;
  readonly attestation: ParentSignature | ClubAttestation;
  readonly wordingVersion: string;
  readonly signedAt: string;
  readonly withdrawnAt: string | null;
  readonly withdrawnBy: ReleaseWithdrawer | null;
};

/** A request sent to a parent's address. */
export type ReleaseRequest = {
  readonly id: string;
  readonly subjectUserId: string;
  /** Normalised. */
  readonly recipientEmail: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly outcome: ReleaseRequestOutcome | null;
  readonly resolvedAt: string | null;
  readonly sends: number;
  readonly lastSentAt: string | null;
};

export type ReleaseRequestStanding = 'open' | 'expired' | ReleaseRequestOutcome;

/** A request's standing at `nowMs`: its outcome, else open until it expires. */
export const releaseRequestStanding = (
  request: Pick<ReleaseRequest, 'outcome' | 'expiresAt'>,
  nowMs: number,
): ReleaseRequestStanding =>
  request.outcome ??
  (nowMs >= instantMs(request.expiresAt) ? 'expired' : 'open');

/** Whether a request can still be answered. */
export const isReleaseRequestOpen = (
  request: Pick<ReleaseRequest, 'outcome' | 'expiresAt'>,
  nowMs: number,
): boolean => releaseRequestStanding(request, nowMs) === 'open';

/** Whether a release still holds. */
const isReleaseActive = (
  release: Pick<MediaReleaseRecord, 'withdrawnAt'>,
): boolean => release.withdrawnAt === null;

/** The minor's active release of this scope, if any (at most one exists). */
export const activeReleaseOf = (
  releases: readonly MediaReleaseRecord[],
  subjectUserId: string,
  scope: MediaReleaseScope,
): MediaReleaseRecord | null =>
  releases.find(
    (release) =>
      release.subjectUserId === subjectUserId &&
      release.scope === scope &&
      isReleaseActive(release),
  ) ?? null;

/**
 * Where a minor stands, as Settings, the club and the coach see it. An active
 * reuse release is on file; else an open request is waiting; else a release
 * a parent withdrew says so (only the parent can sign again); else none.
 */
export type ReleaseStanding =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'waiting';
      readonly request: ReleaseRequest;
      /**
       * The last release was withdrawn by a parent: a new request asks a
       * parent again, and still no club may confirm in their place.
       */
      readonly afterParentWithdrawal: boolean;
    }
  | {
      readonly kind: 'on_file';
      readonly publish: MediaReleaseRecord;
      readonly paidAds: boolean;
    }
  | { readonly kind: 'withdrawn'; readonly release: MediaReleaseRecord };

const latestFirst = (a: MediaReleaseRecord, b: MediaReleaseRecord) =>
  instantMs(b.signedAt) - instantMs(a.signedAt);

export const releaseStandingOf = (input: {
  readonly subjectUserId: string;
  readonly releases: readonly MediaReleaseRecord[];
  readonly requests: readonly ReleaseRequest[];
  readonly nowMs: number;
}): ReleaseStanding => {
  const { subjectUserId, releases, nowMs } = input;
  const publish = activeReleaseOf(releases, subjectUserId, 'publish');
  if (
    publish !== null &&
    reuseLicensingWordings.includes(publish.wordingVersion)
  )
    return {
      kind: 'on_file',
      publish,
      paidAds: activeReleaseOf(releases, subjectUserId, 'paid_ads') !== null,
    };
  const last = releases
    .filter((r) => r.subjectUserId === subjectUserId && r.scope === 'publish')
    .sort(latestFirst)[0];
  const parentWithdrew = last !== undefined && last.withdrawnBy === 'parent';
  const open = input.requests.find(
    (request) =>
      request.subjectUserId === subjectUserId &&
      isReleaseRequestOpen(request, nowMs),
  );
  if (open !== undefined)
    return {
      kind: 'waiting',
      request: open,
      afterParentWithdrawal: parentWithdrew,
    };
  return parentWithdrew
    ? { kind: 'withdrawn', release: last }
    : { kind: 'none' };
};

/** An address shown back to the minor: its first character and its domain. */
export const maskEmail = (email: string): string => {
  const at = email.lastIndexOf('@');
  return at <= 0 ? '•••••' : `${email[0]}•••••${email.slice(at)}`;
};

export const releaseRecipientSchema = z
  .string()
  .max(254)
  .transform(normalizeEmail)
  .pipe(z.email());

// ---------------------------------------------------------------- the minor

export type AskRefusal =
  | 'not_youth'
  | 'already_released'
  | 'invalid_email'
  | 'recipient_stopped'
  | 'too_many';

export type AskFacts = {
  /** The member rates on Youth – Freestyle. */
  readonly youth: boolean;
  readonly standing: ReleaseStanding;
  /** The address asked Daisy not to send it release requests. */
  readonly recipientStopped: boolean;
  /** Requests this minor started in the last 24 hours. */
  readonly asksToday: number;
};

export type AskDecision =
  | {
      readonly ok: true;
      readonly recipientEmail: string;
      /** An open request this one replaces ("Use another email"). */
      readonly cancels: string | null;
    }
  | { readonly ok: false; readonly refusal: AskRefusal };

/** A minor asks a parent's address to sign. */
export const decideAsk = (facts: AskFacts, email: string): AskDecision => {
  if (!facts.youth) return { ok: false, refusal: 'not_youth' };
  if (facts.standing.kind === 'on_file')
    return { ok: false, refusal: 'already_released' };
  const parsed = releaseRecipientSchema.safeParse(email);
  if (!parsed.success) return { ok: false, refusal: 'invalid_email' };
  if (facts.recipientStopped)
    return { ok: false, refusal: 'recipient_stopped' };
  if (facts.asksToday >= mediaReleasePolicy.requestsPerDay)
    return { ok: false, refusal: 'too_many' };
  return {
    ok: true,
    recipientEmail: parsed.data,
    cancels:
      facts.standing.kind === 'waiting' ? facts.standing.request.id : null,
  };
};

export type ResendRefusal = 'not_open' | 'too_soon' | 'too_many';

/** "Send again": one more email for an open request, within its bounds. */
export const decideResend = (
  request: ReleaseRequest,
  nowMs: number,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly refusal: ResendRefusal } => {
  if (!isReleaseRequestOpen(request, nowMs))
    return { ok: false, refusal: 'not_open' };
  if (request.sends >= mediaReleasePolicy.sendsPerRequest)
    return { ok: false, refusal: 'too_many' };
  if (
    request.lastSentAt !== null &&
    nowMs - instantMs(request.lastSentAt) < mediaReleasePolicy.resendAfterMs
  )
    return { ok: false, refusal: 'too_soon' };
  return { ok: true };
};

/** The request's links work until it expires: its expiry, from when it was made. */
export const releaseRequestExpiry = (requestedAtMs: number): string =>
  new Date(requestedAtMs + mediaReleasePolicy.requestTtlMs).toISOString();

// --------------------------------------------------------------- the links

export type ReleaseLink = {
  readonly purpose: ReleaseLinkPurpose;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
};

export type ReleaseLinkVerdict = 'usable' | 'unknown' | 'expired' | 'used';

/** A link is single use and expires; an unknown token answers as unknown. */
export const releaseLinkVerdict = (
  link: ReleaseLink | null,
  purpose: ReleaseLinkPurpose,
  nowMs: number,
): ReleaseLinkVerdict => {
  if (link === null || link.purpose !== purpose) return 'unknown';
  if (link.consumedAt !== null) return 'used';
  return nowMs >= instantMs(link.expiresAt) ? 'expired' : 'usable';
};

// -------------------------------------------------------------- the parent

const signatureFormSchema = z.object({
  wordingVersion: z.literal(mediaReleaseWording.version),
  name: z.string().trim().min(1).max(mediaReleasePolicy.nameMaxLength),
  relation: z.enum(guardianRelations),
  attests: z.literal(true),
  paidAds: z.boolean(),
});

type SignRefusal =
  ReleaseLinkVerdict | 'request_closed' | 'invalid_form' | 'already_released';

export type SignDecision =
  | {
      readonly ok: true;
      readonly scopes: readonly MediaReleaseScope[];
      readonly signature: ParentSignature;
      readonly wordingVersion: typeof mediaReleaseWording.version;
    }
  | { readonly ok: false; readonly refusal: Exclude<SignRefusal, 'usable'> };

/** A parent signs through a sign link: publish, and paid ads only if ticked. */
export const decideSignature = (
  facts: {
    readonly link: ReleaseLinkVerdict;
    readonly request: ReleaseRequest;
    readonly standing: ReleaseStanding;
    readonly nowMs: number;
  },
  form: unknown,
): SignDecision => {
  if (facts.link !== 'usable') return { ok: false, refusal: facts.link };
  if (!isReleaseRequestOpen(facts.request, facts.nowMs))
    return { ok: false, refusal: 'request_closed' };
  return decideParentSignature(
    facts.standing,
    facts.request.recipientEmail,
    form,
  );
};

/** The attestation and scopes are identical for email and linked guardians. */
export const decideParentSignature = (
  standing: ReleaseStanding,
  email: string,
  form: unknown,
): SignDecision => {
  if (standing.kind === 'on_file')
    return { ok: false, refusal: 'already_released' };
  const parsed = signatureFormSchema.safeParse(form);
  if (!parsed.success) return { ok: false, refusal: 'invalid_form' };
  return {
    ok: true,
    scopes: parsed.data.paidAds ? ['publish', 'paid_ads'] : ['publish'],
    wordingVersion: parsed.data.wordingVersion,
    signature: {
      kind: 'parent',
      name: parsed.data.name,
      relation: parsed.data.relation,
      email,
    },
  };
};

/** A parent declines, or says the request is not for them. */
export const decideAnswer = (facts: {
  readonly link: ReleaseLinkVerdict;
  readonly request: ReleaseRequest;
  readonly nowMs: number;
}):
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly refusal:
        Exclude<ReleaseLinkVerdict, 'usable'> | 'request_closed';
    } => {
  if (facts.link !== 'usable') return { ok: false, refusal: facts.link };
  return isReleaseRequestOpen(facts.request, facts.nowMs)
    ? { ok: true }
    : { ok: false, refusal: 'request_closed' };
};

/** The parent's own active releases: what a manage link may act on. */
export type ParentHeld = {
  readonly publish: MediaReleaseRecord | null;
  readonly paidAds: MediaReleaseRecord | null;
};

export const parentHeldOf = (
  releases: readonly MediaReleaseRecord[],
  subjectUserId: string,
  email: string,
): ParentHeld => {
  const own = releases.filter(
    (release) =>
      release.attestation.kind === 'parent' &&
      release.attestation.email === email,
  );
  return {
    publish: activeReleaseOf(own, subjectUserId, 'publish'),
    paidAds: activeReleaseOf(own, subjectUserId, 'paid_ads'),
  };
};

const withdrawalFormSchema = z.object({
  what: z.enum(['whole', 'paid_ads']),
  attests: z.literal(true),
  note: z.string().trim().max(mediaReleasePolicy.noteMaxLength).default(''),
});

export type WithdrawalDecision =
  | {
      readonly ok: true;
      readonly withdraw: readonly string[];
      readonly note: string | null;
    }
  | {
      readonly ok: false;
      readonly refusal: 'invalid_form' | 'nothing_to_withdraw';
    };

/**
 * Withdrawing the whole release withdraws publishing and paid ads; paid ads
 * alone keeps publishing.
 */
export const decideWithdrawal = (
  held: ParentHeld,
  form: unknown,
): WithdrawalDecision => {
  const parsed = withdrawalFormSchema.safeParse(form);
  if (!parsed.success) return { ok: false, refusal: 'invalid_form' };
  const ids = (
    parsed.data.what === 'whole' ? [held.publish, held.paidAds] : [held.paidAds]
  ).flatMap((release) => (release === null ? [] : [release.id]));
  return ids.length === 0
    ? { ok: false, refusal: 'nothing_to_withdraw' }
    : { ok: true, withdraw: ids, note: parsed.data.note || null };
};

export type PaidAdsDecision =
  | { readonly ok: true; readonly change: 'grant' }
  | {
      readonly ok: true;
      readonly change: 'withdraw';
      readonly releaseId: string;
    }
  | { readonly ok: false; readonly refusal: 'no_release' | 'unchanged' };

/** "Change paid-ads choice": paid ads needs an active publish release. */
export const decidePaidAdsChange = (
  held: ParentHeld,
  allow: boolean,
): PaidAdsDecision => {
  if (held.publish === null) return { ok: false, refusal: 'no_release' };
  if (allow)
    return held.paidAds === null
      ? { ok: true, change: 'grant' }
      : { ok: false, refusal: 'unchanged' };
  return held.paidAds === null
    ? { ok: false, refusal: 'unchanged' }
    : { ok: true, change: 'withdraw', releaseId: held.paidAds.id };
};

// ---------------------------------------------------------------- the club

/** A club member as the confirmation reads them. */
export type ClubStudent = {
  readonly userId: string;
  /** An active member of the club. */
  readonly member: boolean;
  /** Rates on Youth – Freestyle. */
  readonly youth: boolean;
  readonly standing: ReleaseStanding;
};

export type ClubConfirmVerdict =
  'eligible' | 'not_a_student' | 'already_on_file' | 'parent_withdrew';

/** Whether the club may confirm a release for this student. */
export const clubConfirmVerdict = (
  student: ClubStudent,
): ClubConfirmVerdict => {
  if (!student.member || !student.youth) return 'not_a_student';
  switch (student.standing.kind) {
    case 'on_file':
      return 'already_on_file';
    case 'withdrawn':
      return 'parent_withdrew';
    case 'waiting':
      return student.standing.afterParentWithdrawal
        ? 'parent_withdrew'
        : 'eligible';
    case 'none':
      return 'eligible';
  }
};

const clubConfirmFormSchema = z.object({
  wordingVersion: z.literal(mediaReleaseWording.version),
  warrants: z.literal(true),
  paidAds: z.boolean(),
  name: z.string().trim().min(1).max(mediaReleasePolicy.nameMaxLength),
  role: z.string().trim().min(1).max(mediaReleasePolicy.roleMaxLength),
});

export type ClubConfirmDecision =
  | {
      readonly ok: true;
      readonly scopes: readonly MediaReleaseScope[];
      readonly name: string;
      readonly role: string;
      readonly wordingVersion: typeof mediaReleaseWording.version;
      readonly confirm: readonly {
        readonly userId: string;
        /** The student's open parent request, now superseded. */
        readonly supersedes: string | null;
      }[];
    }
  | {
      readonly ok: false;
      readonly refusal: 'invalid_form' | 'none_selected' | 'ineligible';
      readonly ineligible: readonly string[];
    };

/** A club confirms releases it holds, for every selected student or none. */
export const decideClubConfirm = (
  students: readonly ClubStudent[],
  form: unknown,
): ClubConfirmDecision => {
  if (students.length === 0)
    return { ok: false, refusal: 'none_selected', ineligible: [] };
  const parsed = clubConfirmFormSchema.safeParse(form);
  if (!parsed.success)
    return { ok: false, refusal: 'invalid_form', ineligible: [] };
  const ineligible = students
    .filter((student) => clubConfirmVerdict(student) !== 'eligible')
    .map((student) => student.userId);
  if (ineligible.length > 0)
    return { ok: false, refusal: 'ineligible', ineligible };
  return {
    ok: true,
    scopes: parsed.data.paidAds ? ['publish', 'paid_ads'] : ['publish'],
    name: parsed.data.name,
    role: parsed.data.role,
    wordingVersion: parsed.data.wordingVersion,
    confirm: students.map((student) => ({
      userId: student.userId,
      supersedes:
        student.standing.kind === 'waiting'
          ? student.standing.request.id
          : null,
    })),
  };
};

// ----------------------------------------------------------------- reuse

/** A release as the reuse fence reads it. */
type ReuseRelease = Pick<
  MediaReleaseRecord,
  'subjectUserId' | 'scope' | 'withdrawnAt' | 'wordingVersion'
>;

/**
 * Whether every youth debater of a Round holds an active release at a
 * wording that licenses reuse. A Round with no youth debater has nothing to
 * release, so this is false for it.
 */
export const everyDebaterReleased = (
  debaterUserIds: readonly string[],
  releases: readonly ReuseRelease[],
): boolean =>
  debaterUserIds.length > 0 &&
  debaterUserIds.every((userId) =>
    releases.some(
      (release) =>
        release.subjectUserId === userId &&
        release.scope === 'publish' &&
        reuseLicensingWordings.includes(release.wordingVersion) &&
        isReleaseActive(release),
    ),
  );

/**
 * The reuse fence (ADR 0161): whether a Round's content may not leave Daisy
 * (download, Stream this Round and its official feed, the ranked content
 * policy's stream-and-earn grant). Viewing never asks it. A Round with a youth
 * debater is fenced unless every youth debater holds an active reuse licence.
 * Youth with no youth debater left fails closed. Any other
 * Round is never fenced. `youthReuseFencedSql` in `@daisy/db` is its SQL
 * mirror.
 */
export const reuseFenced = (round: {
  /** `isYouthRound` of the Round. */
  readonly youth: boolean;
  /** The people in its current debating seats. */
  readonly debaterUserIds: readonly string[];
  readonly releases: readonly ReuseRelease[];
}): boolean =>
  round.youth && !everyDebaterReleased(round.debaterUserIds, round.releases);
