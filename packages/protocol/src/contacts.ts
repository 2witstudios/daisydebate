import { z } from 'zod';
import { idSchema } from './primitives';
import { usernameSchema } from './username';

/**
 * Contacts' own commands (ADR 0072): blocking is a safety choice about a
 * member pair, so the caller names only the other member and the choice;
 * the blocking actor comes from the principal, never the command.
 */
const command = { version: z.literal(1), requestId: idSchema };

export const contactBlockSchema = z.strictObject({
  ...command,
  otherActorId: idSchema,
  blocked: z.boolean(),
});

/** A block by username: discovery proposes the actor, the fence decides. */
export const contactBlockUsernameSchema = z.strictObject({
  ...command,
  username: usernameSchema,
  blocked: z.boolean(),
});

export const contactBlockResultSchema = z.strictObject({
  version: z.literal(1),
  blocked: z.boolean(),
  revision: z.number().int().positive().safe(),
});
