import { createAppError, type ErrorCode } from '@daisy/errors';
import { operatorLimits } from '@daisy/protocol/operator';

const statusOf: Partial<Record<ErrorCode, number>> = {
  VALIDATION: 400,
  AUTHENTICATION: 401,
  AUTHORIZATION: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  INVARIANT: 422,
  INFRASTRUCTURE: 503,
};

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });

/** Every refusal is a fixed code; nothing internal ever leaves. */
export const refusal = (code: ErrorCode) =>
  json(statusOf[code] ?? 500, {
    error: { code: statusOf[code] ? code : 'INTERNAL' },
  });

/** Reads at most the body limit, refusing anything longer before buffering it. */
export async function boundedBody(request: Request): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > operatorLimits.bodyBytes)
    throw createAppError('PAYLOAD_TOO_LARGE');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > operatorLimits.bodyBytes)
    throw createAppError('PAYLOAD_TOO_LARGE');
  return bytes;
}

/** A transport the API refuses before reading the body: an encoding or a non-JSON PUT. */
export function transportRefusal(request: Request): string | null {
  if (request.headers.has('content-encoding')) return 'encoding';
  return request.method === 'PUT' &&
    request.headers.get('content-type') !== 'application/json'
    ? 'content-type'
    : null;
}
