import {
  ageAdmitted,
  authorize,
  type AuthorizationCapability,
  type AuthorizationPrincipal,
} from '@daisy/auth/authorization';
import { decideBetaAccessChange } from '@daisy/auth';
import {
  verifyOperatorRequest,
  type OperatorCrypto,
} from '@daisy/auth/operator-signature';
import type { Database } from '@daisy/db';
import { createAppError, isAppError, type ErrorCode } from '@daisy/errors';
import type { Logger } from '@daisy/logger';
import { noopErrorReporter, type ErrorReporter } from '@daisy/observability';
import { boundedBody, json, refusal, transportRefusal } from './http';
import {
  betaAccessCommandSchema,
  matchOperatorRoute,
  operatorAccountsCursorSchema,
  operatorAccountsPageSchema,
  operatorAccountsQuerySchema,
  operatorLimits,
  type OperatorAccountsPage,
  type OperatorCommandState,
} from '@daisy/protocol/operator';

/**
 * The admin service's configured scope (ADR 0079): every verified key
 * belongs to it, and these are all it may ever ask. Never read from a
 * request.
 */
const operatorService = {
  serviceId: 'daisy-admin',
  capabilities: [
    'account.collection.read',
    'account.beta_access.update',
  ] as const satisfies readonly AuthorizationCapability[],
};

type Store = Pick<
  Database,
  'listOperatorAccounts' | 'runBetaAccessCommand' | 'readOperatorCommand'
>;

export type OperatorApiDependencies = {
  readonly audience: string;
  readonly keys: ReadonlyMap<string, Uint8Array>;
  readonly crypto: OperatorCrypto;
  readonly nowMs: () => number;
  /** True once per service, key and nonce; throws when Redis is down. */
  readonly admitNonce: (input: {
    readonly serviceId: string;
    readonly keyId: string;
    readonly nonce: string;
    readonly ttlSeconds: number;
  }) => Promise<boolean>;
  readonly store: Store;
  readonly nextId: () => string;
  readonly logger: Pick<Logger, 'log'>;
  /** ADR 0037: only the scrubbed reporter sees an unexpected raw error. */
  readonly reporter?: ErrorReporter;
};

const cursorOf = (value: string | undefined) => {
  if (value === undefined) return null;
  try {
    return operatorAccountsCursorSchema.parse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
  } catch {
    throw createAppError('VALIDATION');
  }
};

const encodeCursor = (cursor: object) =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

/**
 * The private operator router (ADR 0079). Order: route, bounds, grammar,
 * key, signature and skew (all in the verifier), then nonce admission,
 * then the evaluator, then the handler. Nothing durable happens before the
 * request is authenticated, and no failure says which check refused it.
 */
export function createOperatorApi(deps: OperatorApiDependencies) {
  const refuse = (cause: string, code: ErrorCode) => {
    deps.logger.log(
      'operator.request.refused',
      { operation: 'operator.request', errorCode: code, cause },
      'Operator request refused',
    );
    return refusal(code);
  };
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const route = matchOperatorRoute(request.method, url.pathname);
    if (!route) return refusal('NOT_FOUND');
    const malformed = transportRefusal(request);
    if (malformed) return refuse(malformed, 'VALIDATION');
    let body: Uint8Array;
    try {
      body = await boundedBody(request);
    } catch {
      return refuse('bounds', 'PAYLOAD_TOO_LARGE');
    }
    const verified = verifyOperatorRequest({
      audience: deps.audience,
      method: request.method,
      path: url.pathname,
      query: [...url.searchParams.entries()],
      headers: [...request.headers.entries()],
      body,
      keys: deps.keys,
      nowMs: deps.nowMs(),
      crypto: deps.crypto,
    });
    if (!verified.ok) return refuse(verified.reason, 'AUTHENTICATION');
    const replay = await nonceRefusal(deps, verified);
    if (replay) return refuse(replay.cause, replay.code);
    const principal: AuthorizationPrincipal = {
      kind: 'operator_service',
      serviceId: operatorService.serviceId,
      keyId: verified.keyId,
      operatorRef: verified.operatorRef,
      capabilities: operatorService.capabilities,
    };
    try {
      return json(200, await dispatch(deps, principal, route, url, body));
    } catch (error) {
      if (isAppError(error)) return refuse('handler', error.code);
      // An unexpected failure is a defect, not a refusal (ISSUE-681).
      (deps.reporter ?? noopErrorReporter).capture(error, {
        requestId: deps.nextId(),
        route: `operator.${route.route}`,
        errorCode: 'INTERNAL',
      });
      return refuse('handler', 'INTERNAL');
    }
  };
}

/** Admits the nonce once; a replay or an unreachable nonce store refuses. */
async function nonceRefusal(
  deps: OperatorApiDependencies,
  verified: { readonly keyId: string; readonly nonce: string },
): Promise<{ cause: string; code: ErrorCode } | null> {
  try {
    const fresh = await deps.admitNonce({
      serviceId: operatorService.serviceId,
      keyId: verified.keyId,
      nonce: verified.nonce,
      ttlSeconds: operatorLimits.nonceTtlSeconds,
    });
    return fresh ? null : { cause: 'replay', code: 'AUTHENTICATION' };
  } catch {
    return { cause: 'nonce-store', code: 'INFRASTRUCTURE' };
  }
}

function dispatch(
  deps: OperatorApiDependencies,
  principal: AuthorizationPrincipal,
  route: NonNullable<ReturnType<typeof matchOperatorRoute>>,
  url: URL,
  body: Uint8Array,
): Promise<unknown> {
  switch (route.route) {
    case 'listAccounts':
      return listAccounts(deps, principal, url);
    case 'setBetaAccess':
      return setBetaAccess(deps, principal, route.id!, body);
    case 'readCommand':
      return readCommand(deps, principal, route.id!);
  }
}

function requireCapability(
  principal: AuthorizationPrincipal,
  capability: AuthorizationCapability,
  account: Parameters<typeof authorize>[0]['context']['account'] = null,
) {
  const decision = authorize({
    principal,
    capability,
    resource:
      capability === 'account.collection.read'
        ? { kind: 'account_collection' }
        : { kind: 'account' },
    context: { account },
  });
  return decision.allow;
}

async function listAccounts(
  deps: OperatorApiDependencies,
  principal: AuthorizationPrincipal,
  url: URL,
): Promise<OperatorAccountsPage> {
  if (!requireCapability(principal, 'account.collection.read'))
    throw createAppError('AUTHORIZATION');
  const query = operatorAccountsQuerySchema.safeParse(
    Object.fromEntries(url.searchParams.entries()),
  );
  if (!query.success) throw createAppError('VALIDATION');
  const cursor = cursorOf(query.data.cursor);
  if (cursor && cursor.access !== query.data.access)
    throw createAppError('VALIDATION');
  const rows = await deps.store.listOperatorAccounts({
    access: query.data.access,
    limit: query.data.limit + 1,
    after: cursor && { requestedAt: cursor.requestedAt, userId: cursor.userId },
  });
  const items = rows.slice(0, query.data.limit);
  const last = items.at(-1);
  return operatorAccountsPageSchema.parse({
    items,
    nextCursor:
      rows.length > query.data.limit && last
        ? encodeCursor({
            v: 1,
            access: query.data.access,
            requestedAt: last.requestedAt,
            userId: last.userId,
          })
        : null,
  });
}

/**
 * SHA3-256 of the command's semantic identity: service, operator, action,
 * target, desired state and expected revision. Transport details (nonce,
 * timestamp, key id) are left out, so a retry under a rotated key replays.
 */
const commandDigest = (
  deps: OperatorApiDependencies,
  principal: Extract<AuthorizationPrincipal, { kind: 'operator_service' }>,
  targetUserId: string,
  command: { state: string; expectedRevision: number },
) =>
  deps.crypto.sha3Hex(
    JSON.stringify([
      principal.serviceId,
      principal.operatorRef,
      'account.beta_access.update',
      targetUserId,
      command.state,
      command.expectedRevision,
    ]),
  );

async function setBetaAccess(
  deps: OperatorApiDependencies,
  principal: AuthorizationPrincipal,
  targetUserId: string,
  body: Uint8Array,
) {
  if (principal.kind !== 'operator_service')
    throw createAppError('AUTHORIZATION');
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw createAppError('VALIDATION');
  }
  const command = betaAccessCommandSchema.safeParse(parsed);
  if (!command.success) throw createAppError('VALIDATION');
  const outcome = await deps.store.runBetaAccessCommand({
    commandId: command.data.commandId,
    serviceId: principal.serviceId,
    operatorRef: principal.operatorRef,
    targetUserId,
    desired: command.data.state,
    expectedRevision: command.data.expectedRevision,
    requestDigest: commandDigest(deps, principal, targetUserId, command.data),
    adminAuditHead: command.data.adminAuditHead,
    nextId: deps.nextId,
    authorize: (account) =>
      requireCapability(principal, 'account.beta_access.update', account),
    decide: (current, ageBand) =>
      decideBetaAccessChange({
        current,
        desired: command.data.state,
        expectedRevision: command.data.expectedRevision,
        ageAdmitted: ageAdmitted(ageBand),
      }),
  });
  if (outcome.kind === 'applied')
    deps.logger.log(
      'operator.command.applied',
      {
        operation: 'operator.beta_access',
        requestId: command.data.commandId,
        userId: targetUserId,
        cause: outcome.result.outcome,
      },
      'Operator beta access command applied',
    );
  return outcome.result;
}

async function readCommand(
  deps: OperatorApiDependencies,
  principal: AuthorizationPrincipal,
  commandId: string,
): Promise<OperatorCommandState> {
  // A read-back reveals one account's access state, as a listing does, so
  // it needs the same capability, decided by the shared evaluator (ISSUE-683).
  if (
    principal.kind !== 'operator_service' ||
    !requireCapability(principal, 'account.collection.read')
  )
    throw createAppError('AUTHORIZATION');
  const command = await deps.store.readOperatorCommand({
    commandId,
    serviceId: principal.serviceId,
  });
  if (!command) throw createAppError('NOT_FOUND');
  return command;
}
