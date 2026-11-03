import type { Identity } from '@daisy/auth';
import { createAppError, createRefusal } from '@daisy/errors';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import { reportCreateSchema, type ReportCreate } from '@daisy/protocol';
import {
  handleOperation,
  parseValidated,
  readJson,
  refusalResponse,
  requireSameOrigin,
  requireSignedIn,
} from '../../server/http';
import { consumeOrThrow, type RateLimiter } from '../../server/rate-limit';
import { reportRefusal, type ReportTargetFacts } from './report-eligibility';

export const reportRefusals = ['report-not-eligible'] as const;

const MAX_BODY_BYTES = 1024;
const REPORT_LIMIT = { max: 20, windowSeconds: 3600 };

export type ReportStore = {
  readonly readReportTargetFacts: (input: {
    readonly reporterUserId: string;
    readonly reporterActorId: string;
    readonly report: ReportCreate;
  }) => Promise<ReportTargetFacts>;
  /** One open report per reporter and target: a repeat keeps the first. */
  readonly fileReport: (input: {
    readonly id: string;
    readonly reporterUserId: string;
    readonly reporterActorId: string;
    readonly report: ReportCreate;
  }) => Promise<void>;
};

/**
 * POST /api/reports: an account reports a Round, a Recording, a chat message
 * or abusive ballot feedback, with a closed reason (WATCH-7). The response
 * says only that it was received, so a repeat looks the same as the first.
 */
export function createReportHandler({
  logger,
  reporter,
  origin,
  identify,
  limiter,
  store,
  nextId,
}: {
  readonly logger: Logger;
  readonly reporter: ErrorReporter;
  readonly origin: () => string;
  readonly identify: (request: Request) => Promise<Identity>;
  readonly limiter: () => RateLimiter;
  readonly store: ReportStore;
  readonly nextId: () => string;
}) {
  return (request: Request) =>
    handleOperation(
      logger,
      request,
      'moderation.report',
      async (requestId) => {
        requireSameOrigin(request, origin());
        const identity = requireSignedIn(await identify(request));
        if (identity.state !== 'member') throw createAppError('AUTHORIZATION');
        const { userId, actorId } = identity.principal;
        if (actorId === null) throw createAppError('AUTHORIZATION');
        await consumeOrThrow(
          limiter(),
          `moderation:report:${userId}`,
          REPORT_LIMIT,
        );
        const report = parseValidated(
          reportCreateSchema,
          await readJson(request, MAX_BODY_BYTES),
        );
        try {
          const refusal = reportRefusal(
            report,
            await store.readReportTargetFacts({
              reporterUserId: userId,
              reporterActorId: actorId,
              report,
            }),
          );
          if (refusal === 'report-not-found') throw createAppError('NOT_FOUND');
          if (refusal) throw createRefusal('CONFLICT', refusal);
          await store.fileReport({
            id: nextId(),
            reporterUserId: userId,
            reporterActorId: actorId,
            report,
          });
          return Response.json({ received: true });
        } catch (error) {
          const refused = refusalResponse(error, requestId, reportRefusals);
          if (refused) return refused;
          throw error;
        }
      },
      reporter,
    );
}
