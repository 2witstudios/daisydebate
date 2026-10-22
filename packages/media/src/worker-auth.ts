import { createHmac, timingSafeEqual } from 'node:crypto';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';

type SignedRequest = {
  readonly method: string;
  readonly path: string;
  readonly body: string;
  readonly timestamp: string;
  readonly signature: string;
};
const unauthorized = () =>
  createAppError('AUTHORIZATION', 'Worker authentication refused');
const route = (path: string) => {
  const parts = path.split('/');
  if (
    parts.length !== 7 ||
    parts[0] !== '' ||
    parts[1] !== 'api' ||
    parts[2] !== 'internal' ||
    parts[3] !== 'media' ||
    !idSchema.safeParse(parts[4]).success ||
    parts[5] !== 'capture' ||
    !['token', 'lease', 'read', 'append', 'observe', 'seal'].includes(parts[6]!)
  )
    throw unauthorized();
  return parts[4]!;
};
const message = (input: Omit<SignedRequest, 'signature'>) => {
  if (
    input.method !== 'POST' ||
    typeof input.body !== 'string' ||
    Buffer.byteLength(input.body, 'utf8') > 128 * 1024
  )
    throw unauthorized();
  route(input.path);
  return `${input.method}\n${input.path}\n${input.timestamp}\n${input.body}`;
};

/** Server-only HMAC capability; no credentials or raw request data are logged. */
export function createMediaWorkerAuthentication(input: {
  readonly secret: string;
  readonly now: () => number;
}) {
  if (!/^[A-Za-z0-9_-]{43,86}$/.test(input.secret))
    throw createAppError(
      'INFRASTRUCTURE',
      'Worker authentication is unavailable',
    );
  const key = Buffer.from(input.secret, 'base64url');
  if (
    key.length < 32 ||
    key.length > 64 ||
    key.toString('base64url') !== input.secret
  )
    throw createAppError(
      'INFRASTRUCTURE',
      'Worker authentication is unavailable',
    );
  const digest = (request: Omit<SignedRequest, 'signature'>) =>
    createHmac('sha256', key).update(message(request), 'utf8').digest();
  return {
    sign(request: Pick<SignedRequest, 'method' | 'path' | 'body'>) {
      const now = input.now();
      if (!Number.isFinite(now)) throw unauthorized();
      const timestamp = new Date(now).toISOString();
      return {
        timestamp,
        signature: digest({ ...request, timestamp }).toString('hex'),
      };
    },
    verify(request: SignedRequest) {
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
          request.timestamp,
        ) ||
        !/^[0-9a-f]{64}$/.test(request.signature)
      )
        throw unauthorized();
      const now = input.now(),
        stamp = Date.parse(request.timestamp);
      if (
        !Number.isFinite(now) ||
        !Number.isFinite(stamp) ||
        new Date(stamp).toISOString() !== request.timestamp ||
        Math.abs(now - stamp) > 5000
      )
        throw unauthorized();
      if (
        !timingSafeEqual(digest(request), Buffer.from(request.signature, 'hex'))
      )
        throw unauthorized();
      const roundId = route(request.path);
      let payload: unknown;
      try {
        payload = JSON.parse(request.body);
      } catch {
        throw unauthorized();
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        throw unauthorized();
      const fields = payload as Record<string, unknown>;
      const worker = idSchema.safeParse(fields.workerId);
      if (
        !worker.success ||
        (fields.roundId !== undefined && fields.roundId !== roundId) ||
        'serviceId' in fields ||
        'actorId' in fields
      )
        throw unauthorized();
      return {
        serviceId: `media-capture:${worker.data}`,
        workerId: worker.data,
        roundId,
      };
    },
  };
}
