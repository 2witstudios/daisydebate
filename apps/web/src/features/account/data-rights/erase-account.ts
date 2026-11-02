import type { Clock } from '@daisy/clock';
import type { Identity } from '@daisy/auth';
import { createAppError, isAppError } from '@daisy/errors';
import type { PrivacySubject } from '@daisy/db/privacy';
import type { Logger } from '@daisy/logger';
import { readBoundedBody } from '../../../server/bounded-body';
import { requireSignedIn, requireSameOrigin } from '../../../server/http';
import { evaluatedIdentity } from '../../../server/member-handler';
import {
  consumeWindowsOrThrow,
  type RateLimiter,
} from '../../../server/rate-limit';
import {
  ACCOUNT_CLOSED_QUERY,
  ERASE_ACCOUNT_QUERY,
  notesErasedCookie,
} from './notices-keys';
import { dataRightsPolicy } from './request-policy';

/** An erase form carries only its confirmation; anything larger is not one. */
const MAX_ERASE_FORM_BYTES = 1024;

const seeOther = (location: string) =>
  new Response(null, {
    status: 303,
    headers: { location, 'cache-control': 'no-store' },
  });

/** Readable by the next page's script, which erases this browser's note copies. */
const erasingNoteCopies = (response: Response) => {
  response.headers.append('set-cookie', notesErasedCookie('1', 60));
  return response;
};

/** Zero trust: the checkbox is the request, and only its one value asks. */
const readConfirmation = async (
  request: Request,
): Promise<'confirmed' | 'unconfirmed' | 'not-a-form'> => {
  const body = await readBoundedBody(request, MAX_ERASE_FORM_BYTES);
  if (body === null) return 'not-a-form';
  return new URLSearchParams(body.toString('utf8')).get('confirm') === 'on'
    ? 'confirmed'
    : 'unconfirmed';
};

/** The erase form's refusals, one fixed sentence each on the settings page. */
export type EraseAccountNotice = 'confirm' | 'rate-limited' | 'refused';

/**
 * POST /api/privacy/erase, the account's erasure request (ISSUE-833, ADR
 * 0087): a native form post that works without JavaScript. Same origin, any
 * authenticated account (members and the waitlisted alike — data rights
 * belong to the account, not to beta participation), the erasure budget, an
 * explicit confirmation, then the one-transaction erasure that closes the
 * account, keeps the competitive record (the username shows closed and
 * stays reserved, DEC-261) and queues vendor deletion. The account's
 * sessions are deleted with it, so the answer is a 303 to the sign-in
 * page's fixed closed notice; every refusal is a 303 back to the settings
 * section with a fixed notice key.
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
      const identity = await identify(request);
      // Same origin held, so this browser asked to close the account and has no
      // session left: a double submit or a lost answer after the closure
      // committed, or an expired session. It cannot tell which, and it asked for
      // its private data to go, so its note copies go in every case.
      if (identity.state === 'anonymous')
        return (await readConfirmation(request)) === 'confirmed'
          ? erasingNoteCopies(seeOther('/sign-in'))
          : seeOther('/sign-in');
      const account = requireSignedIn(identity);
      if (!evaluatedIdentity(account)) throw createAppError('AUTHORIZATION');
      if (account.principal.actorId === null)
        throw createAppError('AUTHORIZATION');
      await consumeWindowsOrThrow(
        limiter(),
        `privacy:erase:${account.principal.userId}`,
        dataRightsPolicy.erase,
      );
      const confirmation = await readConfirmation(request);
      if (confirmation === 'not-a-form') return back('refused');
      if (confirmation === 'unconfirmed') return back('confirm');
      await eraseSubject(
        {
          userId: account.principal.userId,
          actorId: account.principal.actorId,
        },
        clock.now(),
      );
      logger.log(
        'privacy.erase.completed',
        { operation: 'privacy.erase' },
        'Account erasure completed',
      );
      return erasingNoteCopies(seeOther(`/sign-in?${ACCOUNT_CLOSED_QUERY}=1`));
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
