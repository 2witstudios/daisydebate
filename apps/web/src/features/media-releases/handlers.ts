import type { Database } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import { CLIENT_IP_HEADER } from '@daisy/ingress/client-ip';
import { idSchema } from '@daisy/protocol';
import { releaseRecipientSchema } from '@daisy/protocol/media-release';
import { z } from 'zod';
import {
  handleOperation,
  parseValidated,
  readJson,
  requireSameOrigin,
} from '../../server/http';
import {
  runMemberRoute,
  type BudgetedMemberBoundary,
  type MemberCaller,
} from '../../server/member-boundary';
import { consumeOrThrow, type RateRule } from '../../server/rate-limit';
import { recipientKey } from '../mail/recipient-key';
import { isReleaseLinkToken, releaseLinkDigest } from './link-token';
import { verifyReleaseStop } from './stop-token';

const MAX_BODY_BYTES = 8_192;
const json = (value: unknown) =>
  Response.json(value, { headers: { 'cache-control': 'no-store' } });

/** A minor's own release commands: a handful a day is all a person sends. */
const minorRule: RateRule = { windowSeconds: 3_600, max: 30 };
/** A club's confirmations: one per selection, far above a coach's pace. */
const clubRule: RateRule = { windowSeconds: 3_600, max: 60 };
/** A Youth Recording shared: a debater shares a few Rounds at a time. */
const publishRule: RateRule = { windowSeconds: 3_600, max: 30 };
/**
 * One client's parent-page posts (no account): a parent signs once, and a
 * guess at a 256-bit token is hopeless, so this only stops a script.
 */
const parentClientRule: RateRule = { windowSeconds: 3_600, max: 30 };
/** One client asking for manage links by address: never says whether any exists. */
const manageLinkClientRule: RateRule = { windowSeconds: 3_600, max: 5 };

const tokenBody = z.object({ token: z.string().max(64) });
const signBody = tokenBody.extend({ form: z.unknown() });
const answerBody = tokenBody.extend({
  outcome: z.enum(['declined', 'not_me']),
});
const paidAdsBody = tokenBody.extend({ allow: z.boolean() });
const askBody = z.object({ email: z.string().max(400) });
const clubAskBody = z.object({ organizationId: idSchema });
const confirmBody = z.object({
  students: z.array(idSchema).max(200),
  form: z.unknown(),
});
const manageLinkBody = z.object({ email: z.string().max(400) });
const stopBody = z.object({ a: z.string().max(80), t: z.string().max(128) });

export type MediaReleaseRouteDependencies = {
  readonly boundary: BudgetedMemberBoundary;
  /** The youth-publishing release flag: the one counsel gate (PYL-8). */
  readonly released: (accountId: string | null) => Promise<boolean>;
  readonly recipientSubkey: () => string;
  readonly stopSubkey: () => string;
  readonly store: Pick<
    Database,
    'mediaReleases' | 'mediaReleaseClubs' | 'youthRoundPublications'
  >;
};

/**
 * The media release routes (ADR 0151), all behind the youth-publishing flag:
 * the minor's request, the parent's link pages (no account, same origin, the
 * token in the body, never the URL), the club's confirmation, and sharing a
 * Youth Recording. A closed flag answers not found.
 */
export function composeMediaReleaseHandlers(
  deps: MediaReleaseRouteDependencies,
) {
  const { boundary } = deps;
  const gate = async (accountId: string | null) => {
    if (!(await deps.released(accountId))) throw createAppError('NOT_FOUND');
  };
  const member =
    (
      name: Parameters<typeof runMemberRoute>[2]['name'],
      bucket: string,
      rule: RateRule,
      work: (caller: MemberCaller, request: Request) => Promise<unknown>,
    ) =>
    (request: Request) =>
      runMemberRoute(
        boundary,
        request,
        { name, readOnly: false, bucket, rule },
        async (caller) => {
          await gate(caller.userId);
          return json(await work(caller, request));
        },
      );
  /** A parent's post: same origin, no account, limited per client. */
  const parent =
    (
      name: Parameters<typeof handleOperation>[2],
      rule: RateRule,
      work: (request: Request) => Promise<unknown>,
      gated = true,
    ) =>
    (request: Request) =>
      handleOperation(
        boundary.logger,
        request,
        name,
        async () => {
          requireSameOrigin(request, boundary.origin());
          if (gated) await gate(null);
          const client = request.headers.get(CLIENT_IP_HEADER) ?? 'unresolved';
          await consumeOrThrow(
            boundary.limiter(),
            `${name}:client:${client}`,
            rule,
          );
          return json(await work(request));
        },
        boundary.reporter,
      );
  const body = async <T>(request: Request, schema: z.ZodType<T>) =>
    parseValidated(schema, await readJson(request, MAX_BODY_BYTES));
  const digestOf = (purpose: 'sign' | 'manage', token: string) =>
    isReleaseLinkToken(token)
      ? releaseLinkDigest(purpose, token)
      : `${purpose}:`;
  const releases = deps.store.mediaReleases;

  return {
    /** The minor asks a parent's address to sign. */
    ask: member(
      'media-release.ask',
      'media-release:minor',
      minorRule,
      async (caller, request) => {
        const { email } = await body(request, askBody);
        const parsed = releaseRecipientSchema.safeParse(email);
        return releases.ask({
          userId: caller.userId,
          email,
          recipientHash: parsed.success
            ? recipientKey(deps.recipientSubkey(), parsed.data)
            : '0'.repeat(64),
        });
      },
    ),
    resend: member(
      'media-release.resend',
      'media-release:minor',
      minorRule,
      (caller) => releases.resend(caller.userId),
    ),
    cancel: member(
      'media-release.cancel',
      'media-release:minor',
      minorRule,
      (caller) => releases.cancel(caller.userId),
    ),
    /** "Ask my club". */
    askClub: member(
      'media-release.club-ask',
      'media-release:minor',
      minorRule,
      async (caller, request) => {
        const { organizationId } = await body(request, clubAskBody);
        return deps.store.mediaReleaseClubs.askClub({
          userId: caller.userId,
          actorId: caller.actorId,
          organizationId,
        });
      },
    ),
    /** A club's owner or staff confirms releases for selected students. */
    confirm: (organizationId: string) =>
      member(
        'media-release.club-confirm',
        'media-release:club',
        clubRule,
        async (caller, request) => {
          if (!idSchema.safeParse(organizationId).success)
            throw createAppError('NOT_FOUND');
          const { students, form } = await body(request, confirmBody);
          return deps.store.mediaReleaseClubs.confirmClubReleases({
            viewerUserId: caller.userId,
            organizationId,
            studentUserIds: students,
            form,
          });
        },
      ),
    /** A debater shares a Youth Recording publicly. */
    publish: (roundId: string) =>
      member(
        'media-release.publish',
        'media-release:publish',
        publishRule,
        async (caller) => {
          if (!idSchema.safeParse(roundId).success)
            throw createAppError('NOT_FOUND');
          return deps.store.youthRoundPublications.publishYouthRound({
            roundId,
            userId: caller.userId,
            open: true,
          });
        },
      ),
    sign: parent(
      'media-release.parent.sign',
      parentClientRule,
      async (request) => {
        const { token, form } = await body(request, signBody);
        return releases.sign(digestOf('sign', token), form);
      },
    ),
    answer: parent(
      'media-release.parent.answer',
      parentClientRule,
      async (request) => {
        const { token, outcome } = await body(request, answerBody);
        return releases.answer(digestOf('sign', token), outcome);
      },
    ),
    withdraw: parent(
      'media-release.parent.withdraw',
      parentClientRule,
      async (request) => {
        const { token, form } = await body(request, signBody);
        return releases.withdraw(digestOf('manage', token), form);
      },
    ),
    paidAds: parent(
      'media-release.parent.paid-ads',
      parentClientRule,
      async (request) => {
        const { token, allow } = await body(request, paidAdsBody);
        return releases.changePaidAds(digestOf('manage', token), allow);
      },
    ),
    /** A new manage link: from a used sign link, or by the address that signed. */
    manageLink: parent(
      'media-release.parent.manage-link',
      manageLinkClientRule,
      async (request) => {
        const raw = await readJson(request, MAX_BODY_BYTES);
        const byToken = tokenBody.safeParse(raw);
        if (byToken.success) {
          await releases.mailManageLink({
            kind: 'link',
            digest: digestOf('sign', byToken.data.token),
          });
        } else {
          const { email } = parseValidated(manageLinkBody, raw);
          const parsed = releaseRecipientSchema.safeParse(email);
          if (parsed.success)
            await releases.mailManageLink({
              kind: 'email',
              email: parsed.data,
            });
        }
        // The same answer either way: no address is confirmed or denied.
        return { kind: 'sent' };
      },
    ),
    /** "Don't send me release requests": an opt-out works whatever the flag says. */
    stop: parent(
      'media-release.parent.stop',
      parentClientRule,
      async (request) => {
        const { a, t } = await body(request, stopBody);
        const hash = verifyReleaseStop(deps.stopSubkey(), {
          recipientHash: a,
          token: t,
        });
        if (hash === null) throw createAppError('NOT_FOUND');
        await releases.stopRequests(hash);
        return { kind: 'stopped' };
      },
      false,
    ),
  };
}
