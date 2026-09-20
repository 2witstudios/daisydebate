import { getResources } from '../../../../server/resources';
import {
  handleOperation,
  readJson,
  requireSameOrigin,
} from '../../../../server/http';
import {
  createProofDebate,
  getProofDebate,
} from '../../../../features/foundation/operations';

export const runtime = 'nodejs';

export function POST(request: Request) {
  return handleOperation(request, 'foundation.proof.create', async () => {
    requireSameOrigin(request, getResources().config.PUBLIC_APP_URL);
    const resources = getResources();
    const snapshot = await createProofDebate(await readJson(request), {
      clock: resources.clock,
      ids: resources.ids,
    });
    return Response.json(snapshot, { status: 201 });
  });
}

export function GET(request: Request) {
  return handleOperation(request, 'foundation.proof.fetch', async () => {
    const id = new URL(request.url).searchParams.get('id') ?? '';
    return Response.json(await getProofDebate(id));
  });
}
