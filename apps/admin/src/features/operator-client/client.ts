import type { Clock } from '@daisy/clock';
import {
  signOperatorRequest,
  type OperatorCrypto,
} from '@daisy/auth/operator-signature';
import { betaAccessCommandResultSchema } from '@daisy/protocol';
import {
  operatorAccountsPageSchema,
  operatorCommandStateSchema,
  type betaAccessCommandSchema,
} from '@daisy/protocol/operator';
import { z } from 'zod';
import { toBase64Url, type RandomBytes } from '../../auth/secrets';

/**
 * The admin side of the signed operator API (ADR 0079, ADR 0077 amendment).
 * Every request is signed fresh: the injected clock's milliseconds and a
 * 16-byte CSPRNG nonce. A response is trusted only after a strict parse;
 * anything that cannot prove what happened, a timeout or a network error
 * included, is `unknown`, never `failed`, so the caller reconciles it.
 */
export type OperatorClientConfig = {
  readonly baseUrl: string;
  readonly keyId: string;
  readonly key: Uint8Array;
  readonly audience: string;
};

/** How long a signed request may take before its outcome counts as unknown. */
export const OPERATOR_TIMEOUT_MS = 5_000;

export type OperatorFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

/** The refusals the API makes before or instead of any change. */
const definiteRefusals = {
  VALIDATION: 400,
  AUTHENTICATION: 401,
  AUTHORIZATION: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  // The participant's age refusal (ISSUE-664): definite, and it writes nothing.
  INVARIANT: 422,
} as const;
type OperatorRefusal = keyof typeof definiteRefusals;

export type OperatorCall<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'rejected'; readonly code: OperatorRefusal }
  | { readonly kind: 'unknown' };

const errorBodySchema = z.strictObject({
  error: z.strictObject({ code: z.string() }),
});

const NONCE_BYTES = 16;
const unknown = { kind: 'unknown' } as const;

/** The closed outcome of one response; pure over its status and body. */
function callOutcome<T>(
  status: number,
  body: unknown,
  schema: z.ZodType<T>,
): OperatorCall<T> {
  if (status === 200) {
    const parsed = schema.safeParse(body);
    return parsed.success ? { kind: 'ok', value: parsed.data } : unknown;
  }
  const error = errorBodySchema.safeParse(body);
  if (!error.success) return unknown;
  const code = error.data.error.code;
  return Object.hasOwn(definiteRefusals, code) &&
    definiteRefusals[code as OperatorRefusal] === status
    ? { kind: 'rejected', code: code as OperatorRefusal }
    : unknown;
}

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

type Signed = {
  readonly method: 'GET' | 'PUT';
  readonly path: string;
  readonly query: readonly (readonly [string, string])[];
  readonly body?: string;
  /** The signing time a durable record already holds; otherwise now. */
  readonly signedAt?: string;
};

export function createOperatorClient(deps: {
  readonly config: OperatorClientConfig;
  readonly crypto: OperatorCrypto;
  readonly clock: Clock;
  readonly random: RandomBytes;
  readonly fetch: OperatorFetch;
  readonly timeoutMs: number;
}) {
  const { config } = deps;
  async function call<T>(
    operatorRef: string,
    request: Signed,
    schema: z.ZodType<T>,
  ): Promise<OperatorCall<T>> {
    const headers = signOperatorRequest(
      {
        audience: config.audience,
        method: request.method,
        path: request.path,
        query: request.query,
        keyId: config.keyId,
        timestamp: String(Date.parse(request.signedAt ?? deps.clock.now())),
        nonce: toBase64Url(deps.random(NONCE_BYTES)),
        operatorRef,
        body: new TextEncoder().encode(request.body ?? ''),
      },
      config.key,
      deps.crypto,
    );
    const url = new URL(request.path, config.baseUrl);
    for (const [name, value] of request.query)
      url.searchParams.append(name, value);
    try {
      const response = await deps.fetch(url.toString(), {
        method: request.method,
        headers: {
          ...headers,
          ...(request.body === undefined
            ? {}
            : { 'content-type': 'application/json' }),
        },
        ...(request.body === undefined ? {} : { body: request.body }),
        redirect: 'manual',
        signal: AbortSignal.timeout(deps.timeoutMs),
      });
      return callOutcome(response.status, await readJson(response), schema);
    } catch {
      return unknown;
    }
  }

  return {
    listAccounts: (
      operatorRef: string,
      page: {
        readonly access: 'pending' | 'approved' | 'revoked';
        readonly limit: number;
        readonly cursor?: string;
      },
    ) =>
      call(
        operatorRef,
        {
          method: 'GET',
          path: '/operator/v1/accounts',
          query: [
            ['access', page.access],
            ['limit', String(page.limit)],
            ...(page.cursor === undefined
              ? []
              : [['cursor', page.cursor] as const]),
          ],
        },
        operatorAccountsPageSchema,
      ),
    /** Signed at `signedAt`, which the caller recorded first (ADR 0077). */
    setBetaAccess: (
      operatorRef: string,
      targetUserId: string,
      command: z.infer<typeof betaAccessCommandSchema>,
      signedAt: string,
    ) =>
      call(
        operatorRef,
        {
          method: 'PUT',
          path: `/operator/v1/accounts/${targetUserId}/beta-access`,
          query: [],
          body: JSON.stringify(command),
          signedAt,
        },
        betaAccessCommandResultSchema,
      ),
    readCommand: (operatorRef: string, commandId: string) =>
      call(
        operatorRef,
        {
          method: 'GET',
          path: `/operator/v1/commands/${commandId}`,
          query: [],
        },
        operatorCommandStateSchema,
      ),
  };
}
export type OperatorClient = ReturnType<typeof createOperatorClient>;
