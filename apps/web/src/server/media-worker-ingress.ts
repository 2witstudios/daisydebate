import { createAppError } from '@daisy/errors';
import {
  createMediaWorkerAuthentication,
  type MediaWorkerRole,
} from '@daisy/media/internal';
import type { App } from './app';
import { readBytes } from './http';

type Authentication = ReturnType<typeof createMediaWorkerAuthentication>;

/**
 * The deployment's media-worker signing, built on first use from
 * MEDIA_WORKER_SECRET; refuses without it. Every worker role verifies
 * through it.
 */
export function mediaWorkerAuthentication(app: App) {
  let authentication: Authentication | undefined;
  return () => {
    const secret = app.config.MEDIA_WORKER_SECRET;
    if (!secret) throw createAppError('INFRASTRUCTURE');
    return (authentication ??= createMediaWorkerAuthentication({
      secret,
      now: () => Date.parse(app.clock.now()),
    }));
  };
}

/**
 * The signed media-worker ingress every worker role's handler reads its
 * request through: the exact UTF-8 body, verified for `role` only, with the
 * Round taken from the signed path. Another role's principal is refused.
 */
export async function readSignedWorkerRequest(
  request: Request,
  authentication: Authentication,
  role: MediaWorkerRole,
) {
  const bytes = await readBytes(request, 128 * 1024);
  let body: string;
  try {
    body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw createAppError('VALIDATION');
  }
  const url = new URL(request.url);
  const principal = authentication.verify({
    method: request.method,
    path: `${url.pathname}${url.search}`,
    body,
    timestamp: request.headers.get('x-daisy-media-timestamp') ?? '',
    signature: request.headers.get('x-daisy-media-signature') ?? '',
  });
  if (principal.role !== role) throw createAppError('AUTHORIZATION');
  // Authentication parsed the exact signed JSON object and refused conflicting scope.
  const payload: Readonly<Record<string, unknown>> = {
    ...(JSON.parse(body) as Record<string, unknown>),
    roundId: principal.roundId,
  };
  return { principal, payload, operation: url.pathname.split('/').at(-1) };
}
