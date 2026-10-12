import { z } from 'zod';
import { idSchema } from '../primitives';
import { messagingTextSchema } from './core';

/** Own-reaction overlay contract: at most this many choices, each at most this many UTF-16 units. */
export const MAX_MESSAGING_REACTION_CHOICES = 8;
export const MAX_MESSAGING_REACTION_UNITS = 16;

/** Explicit choices restrict additions; retained own choices remain removable. */
export type MessagingReactionPolicy = {
  readonly reactionUnits: number;
  readonly choices: readonly string[];
};

export function createMessagingReactionSchemas(
  policy: MessagingReactionPolicy,
) {
  z.number()
    .int()
    .positive()
    .max(MAX_MESSAGING_REACTION_UNITS)
    .parse(policy.reactionUnits);
  const reaction = messagingTextSchema(policy.reactionUnits).refine(
    (value) => value.trim() === value,
  );
  const choices = z
    .array(reaction)
    .nonempty()
    .max(MAX_MESSAGING_REACTION_CHOICES)
    .refine((items) => new Set(items).size === items.length)
    .parse(policy.choices);
  const summary = z.strictObject({
    reaction,
    count: z.number().int().positive().safe(),
    own: z.boolean(),
  });
  const reactions = z
    .array(summary)
    .refine(
      (items) =>
        new Set(items.map((item) => item.reaction)).size === items.length,
    );
  const scope = {
    version: z.literal(1),
    channelId: idSchema,
    messageId: idSchema,
  };
  return {
    scope: z.strictObject(scope),
    command: z
      .strictObject({
        ...scope,
        requestId: idSchema,
        reaction,
        active: z.boolean(),
      })
      .refine((intent) => !intent.active || choices.includes(intent.reaction)),
    result: z.strictObject({
      ...scope,
      changeVersion: z.number().int().nonnegative().safe(),
      replayed: z.boolean(),
      reactions,
    }),
  };
}
