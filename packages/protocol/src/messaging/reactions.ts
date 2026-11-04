import { z } from 'zod';
import { idSchema } from '../primitives';
import { messagingTextSchema } from './core';

/** Explicit choices restrict additions; retained own choices remain removable. */
export type MessagingReactionPolicy = {
  readonly reactionUnits: number;
  readonly choices: readonly string[];
  /** DEC-251: distinct reactions one member may hold on one message. */
  readonly distinctPerMessage: number;
};

const scope = {
  version: z.literal(1),
  channelId: idSchema,
  messageId: idSchema,
};

/** A scoped aggregate's wire shape; validating it supplies no reaction authority. */
export function createMessagingReactionResultSchema(reactionUnits: number) {
  const reactions = z
    .array(
      z.strictObject({
        reaction: messagingTextSchema(reactionUnits).refine(
          (value) => value.trim() === value,
        ),
        count: z.number().int().positive().safe(),
        own: z.boolean(),
      }),
    )
    .refine(
      (items) =>
        new Set(items.map((item) => item.reaction)).size === items.length,
    );
  return z.strictObject({
    ...scope,
    changeVersion: z.number().int().nonnegative().safe(),
    replayed: z.boolean(),
    reactions,
  });
}

export function createMessagingReactionSchemas(
  policy: MessagingReactionPolicy,
) {
  const reaction = messagingTextSchema(policy.reactionUnits).refine(
    (value) => value.trim() === value,
  );
  const choices = z
    .array(reaction)
    .nonempty()
    .refine((items) => new Set(items).size === items.length)
    .parse(policy.choices);
  z.number().int().positive().safe().parse(policy.distinctPerMessage);
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
    result: createMessagingReactionResultSchema(policy.reactionUnits),
  };
}
