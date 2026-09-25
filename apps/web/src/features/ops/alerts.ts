import type { Clock } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
import {
  evaluateAlerts,
  readAlertSnapshot,
  type AlertStateRedis,
} from '../../server/alert-state';
import { handleOperation } from '../../server/http';
import { requireProbeToken } from './probe-auth';

/**
 * `GET /api/ops/alerts` (AUTH-7.7): a non-mutating, token-gated read of the
 * current alert-condition snapshot. The scheduled probe workflow (outside
 * this app, since staging scales to zero) calls this every 5 minutes and
 * fires an operator alert for whatever `conditions` names. Every field is a
 * count or a timestamp — no email, token, or client address.
 */
export function createAlertsHandler({
  logger,
  redis,
  clock,
  token,
}: {
  readonly logger: Logger;
  readonly redis: AlertStateRedis;
  readonly clock: Clock;
  /** Read lazily per request: baseline startup never requires auth configuration (ADR 0020). */
  readonly token: () => string;
}) {
  return (request: Request) =>
    handleOperation(logger, request, 'ops.alerts', async () => {
      requireProbeToken(request, token());
      const snapshot = await readAlertSnapshot({ redis, clock });
      return Response.json({
        now: snapshot.nowIso,
        conditions: evaluateAlerts(snapshot),
        snapshot,
      });
    });
}
