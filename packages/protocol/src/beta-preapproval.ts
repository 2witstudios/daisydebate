import { z } from 'zod';
import { idSchema } from './primitives';
import { normalizeEmail } from './email';

export const preapprovalAction = 'beta.preapproval.update';
export const preapprovalEmailSchema = z
  .string()
  .max(320)
  .transform(normalizeEmail)
  .pipe(z.email());
export const invitationStates = [
  'none',
  'queued',
  'sent',
  'suppressed',
  'failed',
  'cancelled',
  'unknown',
] as const;
export const preapprovalCommandSchema = z.discriminatedUnion('operation', [
  z.strictObject({
    v: z.literal(1),
    commandId: idSchema,
    adminAuditHead: z.string().regex(/^[0-9a-f]{64}$/),
    operation: z.literal('add'),
    email: preapprovalEmailSchema,
    invite: z.boolean(),
  }),
  z.strictObject({
    v: z.literal(1),
    commandId: idSchema,
    adminAuditHead: z.string().regex(/^[0-9a-f]{64}$/),
    operation: z.enum(['invite', 'remove']),
    preapprovalId: idSchema,
    expectedRevision: z.number().int().positive(),
  }),
]);
export type PreapprovalCommand = z.infer<typeof preapprovalCommandSchema>;
export const preapprovalResultSchema = z.strictObject({
  commandId: idSchema,
  preapprovalId: idSchema,
  revision: z.number().int().positive(),
  outcome: z.enum(['saved', 'removed', 'unchanged']),
  mail: z.enum(['queued', 'none']),
});
export type PreapprovalResult = z.infer<typeof preapprovalResultSchema>;
export const preapprovalStateSchema = z.strictObject({
  action: z.literal(preapprovalAction),
  result: preapprovalResultSchema,
  mailState: z.enum(invitationStates),
});
export const preapprovalReceiptSchema = z.strictObject({
  action: z.literal(preapprovalAction),
  result: preapprovalResultSchema,
});
export const preapprovalQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: idSchema.optional(),
});
export const preapprovalEntrySchema = z.strictObject({
  id: idSchema,
  email: preapprovalEmailSchema,
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  status: z.enum(['unused', 'claimed']),
  invitation: z.enum(invitationStates),
});
export const preapprovalPageSchema = z.strictObject({
  items: z.array(preapprovalEntrySchema).max(100),
  nextCursor: idSchema.nullable(),
});
export type PreapprovalPage = z.infer<typeof preapprovalPageSchema>;

/** Only a fresh verified, eligible, unrestricted pending account can claim. */
export const canClaimPreapproval = (input: {
  readonly verified: boolean;
  readonly erased: boolean;
  readonly restricted: boolean;
  readonly state: string | null;
  readonly ageBand: string | null;
}): boolean =>
  input.verified &&
  !input.erased &&
  !input.restricted &&
  input.state === 'pending' &&
  (input.ageBand === 'adult' || input.ageBand === '16-17');
