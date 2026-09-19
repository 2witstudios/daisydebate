import { withTimeout } from '@daisy/observability';
import { getResources } from '../../../../server/resources';
import { handleOperation } from '../../../../server/http';
export const runtime = 'nodejs';
export function GET(request: Request) {
  return handleOperation(request, 'health.readiness', async () => {
    const { database, redis, draining } = getResources();
    const results = await Promise.allSettled([
      withTimeout(database.health(), 2000),
      withTimeout(redis.health(), 2000),
    ]);
    const ready =
      !draining &&
      results.every((result) => result.status === 'fulfilled' && result.value);
    return Response.json(
      { status: ready ? 'ready' : 'unavailable' },
      { status: ready ? 200 : 503 },
    );
  });
}
