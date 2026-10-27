import { z } from 'zod';
import {
  betaAccessCommandResultSchema,
  betaAccessCommandStateSchema,
  betaAccessStates,
} from './beta-access';
import { idSchema } from './primitives';

/**
 * The signed internal operator API, version 1 (ADR 0079): the portable
 * contract the admin app signs and the participant app verifies. Every
 * route, query key and body is closed; a future action is a new typed
 * resource here, never a generic command.
 */
export const operatorSignatureVersion = 'DAISY-OPERATOR-V1';

/** The exact headers a signed request carries; any other `Daisy-*` header is refused. */
export const operatorHeaders = {
  keyId: 'daisy-key-id',
  timestamp: 'daisy-timestamp',
  nonce: 'daisy-nonce',
  operator: 'daisy-operator',
  signature: 'daisy-signature',
} as const;

/** Body, header and clock bounds checked before any signature work. */
export const operatorLimits = {
  bodyBytes: 16 * 1024,
  headerBytes: 8 * 1024,
  skewMs: 30_000,
  nonceTtlSeconds: 120,
  /**
   * The participant commits a command only while its signed timestamp is
   * within skew, checked last, and bounds each statement (COMMIT included)
   * by this, so a PUT can never apply later than this past its deadline.
   */
  commandBoundMs: 5_000,
} as const;

export const operatorAudienceSchema = z
  .string()
  .regex(/^daisy-web:(staging|production|local)$/);
export const operatorKeyIdSchema = z.string().regex(/^[a-z0-9]{3,32}$/);
export const operatorNonceSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);

/** Each route: its method, its path shape and the query keys it accepts. */
export const operatorRoutes = {
  listAccounts: {
    method: 'GET',
    path: /^\/operator\/v1\/accounts$/,
    query: ['access', 'cursor', 'limit'],
  },
  setBetaAccess: {
    method: 'PUT',
    path: /^\/operator\/v1\/accounts\/([a-z0-9]{24})\/beta-access$/,
    query: [],
  },
  readCommand: {
    method: 'GET',
    path: /^\/operator\/v1\/commands\/([a-z0-9]{24})$/,
    query: [],
  },
} as const;
export type OperatorRoute = keyof typeof operatorRoutes;

/** The route a method and path name, or null for anything else. */
export function matchOperatorRoute(
  method: string,
  path: string,
): { readonly route: OperatorRoute; readonly id: string | null } | null {
  for (const [route, spec] of Object.entries(operatorRoutes)) {
    if (spec.method !== method) continue;
    const match = spec.path.exec(path);
    if (match) return { route: route as OperatorRoute, id: match[1] ?? null };
  }
  return null;
}

const accessFilter = z.enum(betaAccessStates);

export const operatorAccountsQuerySchema = z.strictObject({
  access: accessFilter,
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(256).optional(),
});

/** The keyset position a page continues from, bound to its filter. */
export const operatorAccountsCursorSchema = z.strictObject({
  v: z.literal(1),
  access: accessFilter,
  requestedAt: z.iso.datetime(),
  userId: idSchema,
});

const operatorAccountSchema = z.strictObject({
  userId: idSchema,
  username: z.string().nullable(),
  accessState: accessFilter,
  accessRevision: z.number().int().positive(),
  requestedAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
});

/** A page the API returns; the router parses its own output against it. */
export const operatorAccountsPageSchema = z.strictObject({
  items: z.array(operatorAccountSchema).max(100),
  nextCursor: z.string().max(256).nullable(),
});
export type OperatorAccountsPage = z.infer<typeof operatorAccountsPageSchema>;

/** Minted by the admin app before the first send and kept across retries. */
export const betaAccessCommandSchema = z.strictObject({
  v: z.literal(1),
  commandId: idSchema,
  state: z.enum(['approved', 'revoked']),
  expectedRevision: z.number().int().positive(),
  /** The admin audit chain head after this command's intent (cross-database anchor). */
  adminAuditHead: z.string().regex(/^[0-9a-f]{64}$/),
});

/**
 * `GET /operator/v1/commands/{id}`: a command's stored result, for the admin
 * app to reconcile a response it never received. Discriminated by the
 * receipt's action; each action's owner defines its variant.
 */
export const operatorCommandStateSchema = z.discriminatedUnion('action', [
  betaAccessCommandStateSchema,
]);

/** What a receipt stores: the result of whichever action it records. */
export const operatorCommandResultSchema = z.union([
  betaAccessCommandResultSchema,
]);
export type OperatorCommandState = z.infer<typeof operatorCommandStateSchema>;
