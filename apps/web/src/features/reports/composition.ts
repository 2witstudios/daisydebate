import { reportCommandSchema, reportResultSchema } from '@daisy/protocol';
import { appDiscoverActor } from '../account/username-discovery';
import { contactPairFence } from '../contacts/authorization';
import type { App } from '../../server/app';
import { parseValidated, readJson } from '../../server/http';
import {
  memberHttpBoundary,
  runEvaluatedRoute,
} from '../../server/member-boundary';
import { consumeOrThrow } from '../../server/rate-limit';
import { fileReport, REPORT_RULE } from './operations';

const MAX_BODY_BYTES = 1024;

/** Reports (ADR 0103). */
export function composeReportRoutes(app: App) {
  const boundary = memberHttpBoundary(app);
  return {
    file: (request: Request) =>
      runEvaluatedRoute(boundary, request, {
        name: 'reports.file',
        readOnly: false,
        readInput: () => readJson(request, MAX_BODY_BYTES),
        operation: async (input, principal) => {
          const { username, reason, surface } = parseValidated(
            reportCommandSchema,
            input,
          );
          return reportResultSchema.parse({
            version: 1,
            ...(await fileReport(
              principal,
              { username, reason, surface },
              {
                clock: app.clock,
                ids: app.ids,
                limit: (actorId) =>
                  consumeOrThrow(
                    app.limiter,
                    `reports:${actorId}`,
                    REPORT_RULE,
                  ),
                discover: appDiscoverActor(app),
                store: () =>
                  app.database.reportStore(
                    contactPairFence({
                      principal,
                      capability: 'social.report',
                    }),
                  ),
              },
            )),
          });
        },
      }),
  };
}
