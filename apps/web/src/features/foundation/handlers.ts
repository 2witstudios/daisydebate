import type { Logger } from '@daisy/logger';
import {
  handleOperation,
  readJson,
  requireSameOrigin,
  requireSameOriginRead,
} from '../../server/http';
import {
  createProofDebate,
  getProofDebate,
  type ProofDependencies,
} from './operations';

/**
 * `/api/foundation/proof`: POST creates a proof debate, GET restores one by
 * id. Both are same-origin and gated by the injected proof flag.
 */
export function createProofHandlers({
  origin,
  logger,
  ...dependencies
}: ProofDependencies & {
  readonly origin: string;
  readonly logger: Logger;
}) {
  return {
    POST: (request: Request) =>
      handleOperation(logger, request, 'foundation.proof.create', async () => {
        requireSameOrigin(request, origin);
        const snapshot = await createProofDebate(
          await readJson(request),
          dependencies,
        );
        return Response.json(snapshot, { status: 201 });
      }),
    GET: (request: Request) =>
      handleOperation(logger, request, 'foundation.proof.fetch', async () => {
        requireSameOriginRead(request, origin);
        const id = new URL(request.url).searchParams.get('id') ?? '';
        return Response.json(await getProofDebate(id, dependencies));
      }),
  };
}
