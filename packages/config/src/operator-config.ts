import { z } from 'zod';
import { secret } from './secrets';

/** ADR 0079: the signed operator API's listener configuration. */
export const operatorFields = {
  /**
   * ADR 0079: the signed operator API's keys (`kid:base64url`, one or two).
   * Absent, the private operator listener does not start.
   */
  OPERATOR_API_KEYS: secret(z.string().min(1)).optional(),
  /** The audience every operator signature is bound to; required with keys. */
  OPERATOR_AUDIENCE: z
    .enum(['daisy-web:staging', 'daisy-web:production', 'daisy-web:local'])
    .optional(),
  /**
   * Where the operator listener binds: `fly-local-6pn` (resolved to this
   * machine's private address) or a loopback literal in development and
   * tests. Never a wildcard.
   */
  OPERATOR_LISTEN_HOST: z
    .union([
      z.literal('fly-local-6pn'),
      z.literal('127.0.0.1'),
      z.literal('::1'),
    ])
    .optional(),
  OPERATOR_PORT: z.coerce.number().int().min(1).max(65535).default(8081),
};

type OperatorConfig = {
  readonly NODE_ENV: string;
  readonly OPERATOR_API_KEYS?: string | undefined;
  readonly OPERATOR_AUDIENCE?: string | undefined;
  readonly OPERATOR_LISTEN_HOST?: string | undefined;
};

/**
 * Keys need an audience and a listen host, and production binds the
 * listener to the private network only.
 */
export function refineOperatorConfig(
  config: OperatorConfig,
  ctx: z.RefinementCtx,
) {
  if (config.OPERATOR_API_KEYS === undefined) return;
  if (
    config.OPERATOR_AUDIENCE === undefined ||
    config.OPERATOR_LISTEN_HOST === undefined
  )
    ctx.addIssue({
      code: 'custom',
      path: ['OPERATOR_API_KEYS'],
      message: 'Operator keys need an audience and a listen host',
    });
  if (
    config.NODE_ENV === 'production' &&
    config.OPERATOR_LISTEN_HOST !== 'fly-local-6pn'
  )
    ctx.addIssue({
      code: 'custom',
      path: ['OPERATOR_LISTEN_HOST'],
      message: 'Production binds the operator API to the private network',
    });
}
