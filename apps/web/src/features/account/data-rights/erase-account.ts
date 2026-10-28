import type { Clock } from '@daisy/clock';
import type { Identity } from '@daisy/auth';
import { createAppError, isAppError } from '@daisy/errors';
import type { PrivacySubject } from '@daisy/db/privacy';
import type { Logger } from '@daisy/logger';
import { readBoundedBody } from '../../../server/bounded-body';
import { requireSignedIn, requireSameOrigin } from '../../../server/http';
import {
  consumeWindowsOrThrow,
  type RateLimiter,
} from '../../../server/rate-limit';
import { ACCOUNT_CLOSED_QUERY, ERASE_ACCOUNT_QUERY } from './notices-keys';
import { dataRightsPolicy } from './request-policy';

/** An erase form carries only its confirmation; anything larger is not one. */
const MAX_ERASE_FORM_BYTES = 1024;

const seeOther = (location: string) =>
  new Response(null, { status: 303, headers: { location } });

/** The erase form's refusals, one fixed sentence each on the settings page. */
export type EraseAccountNotice = 'confirm' | 'rate-limited' | 'refused';

/**
 * POST /api/privacy/erase, the member's erasure request (ISSUE-833, ADR
 * 0087): a native form post that works without JavaScript. Same origin,
 * signed-in member, the erasure budget, an explicit confirmation, then the
 * one-transaction erasure that closes the account, keeps the competitive
 * record (the username shows closed and stays reserved, DEC-261) and queues
 * vendor deletion. The member's sessions are deleted with the account, so
 * the answer is a 303 to the sign-in page's fixed closed notice; every
 * refusal is a 303 back to the settings section with a fixed notice key.
 */
export function createEraseAccountHandler({
  logger,
  origin,
  identify,
  limiter,
  clock,
  eraseSubject,
}: {
  readonly logger: Logger;
  readonly origin: () => string;
  readonly identify: (request: Request) => Promise<Identity>;
  readonly limiter: () => RateLimiter;
  readonly clock: Clock;
  readonly eraseSubject: (
    subject: PrivacySubject,
    now: string,
  ) => Promise<{ readonly alreadyErased: boolean }>;
}) {
  return async (request: Request): Promise<Response> => {
    const back = (notice: EraseAccountNotice) =>
      seeOther(`/settings?${ERASE_ACCOUNT_QUERY}=${notice}`);
    try {
      requireSameOrigin(request, origin());
      const member = requireSignedIn(await identify(request));
      if (member.state !== 'member') throw createAppError('AUTHORIZATION');
      if (member.principal.actorId === null)
        throw createAppError('AUTHORIZATION');
      await consumeWindowsOrThrow(
        limiter(),
        `privacy:erase:${member.principal.userId}`,
        dataRightsPolicy.erase,
      );
      const body = await readBoundedBody(request, MAX_ERASE_FORM_BYTES);
      // Zero trust: the checkbox is the request, and only its one value asks;
      // anything larger than an erase form is not one.
      if (body === null) return back('refused');
      if (new URLSearchParams(body.toString('utf8')).get('confirm') !== 'on')
        return back('confirm');
      await eraseSubject(
        {
          userId: member.principal.userId,
          actorId: member.principal.actorId,
        },
        clock.now(),
      );
      logger.log(
        'privacy.erase.completed',
        { operation: 'privacy.erase' },
        'Account erasure completed',
      );
      return seeOther(`/sign-in?${ACCOUNT_CLOSED_QUERY}=1`);
    } catch (error) {
      if (isAppError(error) && error.code === 'AUTHENTICATION')
        return seeOther('/sign-in');
      const code = isAppError(error) ? error.code : 'INTERNAL';
      logger.log(
        'privacy.erase.failed',
        { operation: 'privacy.erase', errorCode: code },
        'Account erasure refused',
      );
      return back(code === 'RATE_LIMIT' ? 'rate-limited' : 'refused');
    }
  };
}
