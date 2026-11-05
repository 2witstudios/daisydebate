import { z } from 'zod';
import { idSchema } from './primitives';

export const flagKeySchema = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/);
export const flagStates = ['default', 'enabled', 'disabled', 'killed'] as const;
export type FlagState = (typeof flagStates)[number];

/** Facts for one server-selected subject, never a participant response contract. */
export type FlagFact = {
  readonly key: string;
  readonly revision: number;
  readonly state: FlagState;
  readonly override: {
    readonly enabled: boolean;
    readonly expiresAt: number;
  } | null;
};
export type FlagSnapshot =
  | { readonly kind: 'available'; readonly flags: readonly FlagFact[] }
  | { readonly kind: 'unavailable' };

const command = {
  v: z.literal(1),
  commandId: idSchema,
  expectedRevision: z.number().int().min(0).max(2_147_483_646),
  adminAuditHead: z.string().regex(/^[0-9a-f]{64}$/),
};
export const flagStateCommandSchema = z.strictObject({
  ...command,
  state: z.enum(flagStates),
});
export const flagOverrideCommandSchema = z.strictObject({
  ...command,
  accountId: idSchema,
  override: z
    .strictObject({ enabled: z.boolean(), expiresAt: z.iso.datetime() })
    .nullable(),
});
export const flagCommandActions = [
  'flag.state.update',
  'flag.override.update',
] as const;
export type FlagCommandAction = (typeof flagCommandActions)[number];
export const flagCommandResultSchema = z.strictObject({
  commandId: idSchema,
  key: flagKeySchema,
  revision: z.number().int().positive(),
});
export type FlagCommandResult = z.infer<typeof flagCommandResultSchema>;
export const flagCommandStateSchema = z.strictObject({
  action: z.enum(flagCommandActions),
  result: flagCommandResultSchema,
});
export const flagOperatorRoutes = {
  setFlagState: {
    method: 'PUT',
    path: /^\/operator\/v1\/flags\/([a-z][a-z0-9-]{1,63})\/state$/,
    query: [],
  },
  setFlagOverride: {
    method: 'PUT',
    path: /^\/operator\/v1\/flags\/([a-z][a-z0-9-]{1,63})\/account-override$/,
    query: [],
  },
} as const;
