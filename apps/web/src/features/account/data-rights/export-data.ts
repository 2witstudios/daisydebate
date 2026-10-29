import type { Identity } from '@daisy/auth';
import { createAppError, isAppError } from '@daisy/errors';
import type { PrivacyExport, PrivacySubject } from '@daisy/db/privacy';
import type { Logger } from '@daisy/logger';
import { requireSignedIn, requireSameOrigin } from '../../../server/http';
import { evaluatedIdentity } from '../../../server/member-handler';
import {
  consumeWindowsOrThrow,
  type RateLimiter,
} from '../../../server/rate-limit';
import { EXPORT_DATA_QUERY } from './notices-keys';
import { dataRightsPolicy } from './request-policy';

const seeOther = (location: string) =>
  new Response(null, {
    status: 303,
    headers: { location, 'cache-control': 'no-store' },
  });

/** The export form's refusals, one fixed sentence each on the settings page. */
export type ExportDataNotice = 'rate-limited' | 'refused';

/**
 * POST /api/privacy/export, the account's access-and-portability request
 * (ISSUE-833, ADR 0087): a native form post that works without JavaScript.
 * Same origin, any authenticated account (members and the waitlisted alike —
 * data rights belong to the account, not to beta participation), the export
 * budget, then the whole subject-rights composition under one lock. The
 * answer is the export as a no-store JSON download; every refusal is a 303
 * back to the settings section with a fixed notice key, never the reason's
 * internals.
 */
export function createExportDataHandler({
  logger,
  origin,
  identify,
  limiter,
  exportSubject,
}: {
  readonly logger: Logger;
  readonly origin: () => string;
  readonly identify: (request: Request) => Promise<Identity>;
  readonly limiter: () => RateLimiter;
  readonly exportSubject: (subject: PrivacySubject) => Promise<PrivacyExport>;
}) {
  return async (request: Request): Promise<Response> => {
    const back = (notice: ExportDataNotice) =>
      seeOther(`/settings?${EXPORT_DATA_QUERY}=${notice}`);
    try {
      requireSameOrigin(request, origin());
      const account = requireSignedIn(await identify(request));
      if (!evaluatedIdentity(account)) throw createAppError('AUTHORIZATION');
      if (account.principal.actorId === null)
        throw createAppError('AUTHORIZATION');
      await consumeWindowsOrThrow(
        limiter(),
        `privacy:export:${account.principal.userId}`,
        dataRightsPolicy.exportData,
      );
      const exported = await exportSubject({
        userId: account.principal.userId,
        actorId: account.principal.actorId,
      });
      logger.log(
        'privacy.export.completed',
        { operation: 'privacy.export' },
        'Data export completed',
      );
      return new Response(JSON.stringify(exported), {
        headers: {
          'content-type': 'application/json',
          'content-disposition': `attachment; filename="daisy-export-${account.principal.userId}.json"`,
          'cache-control': 'no-store',
        },
      });
    } catch (error) {
      if (isAppError(error) && error.code === 'AUTHENTICATION')
        // No live session: the sign-in page is where this account is.
        return seeOther('/sign-in');
      const code = isAppError(error) ? error.code : 'INTERNAL';
      logger.log(
        'privacy.export.failed',
        { operation: 'privacy.export', errorCode: code },
        'Data export refused',
      );
      return back(code === 'RATE_LIMIT' ? 'rate-limited' : 'refused');
    }
  };
}
