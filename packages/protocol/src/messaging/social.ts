import { z } from 'zod';
import { idSchema } from '../primitives';
import { messagingTextSchema } from './core';

export type MessagingSocialBounds = Readonly<{
  introductionUnits: number;
  titleUnits: number;
  batchActors: number;
}>;

export const messagingDmResultSchema = z.strictObject({
  version: z.literal(1),
  channelId: idSchema,
  state: z.enum(['pending', 'accepted', 'declined', 'cancelled']),
});
export const messagingDmDecisionResultSchema = messagingDmResultSchema.extend({
  state: z.enum(['accepted', 'declined', 'cancelled']),
});

export const messagingGroupInvitationResultSchema = z.strictObject({
  version: z.literal(1),
  channelId: idSchema,
  generation: z.number().int().positive().safe(),
  state: z.enum(['pending', 'accepted', 'declined', 'cancelled']),
});

/** Actor comes from the principal; contact facts never come from a command. */
export function createMessagingSocialSchemas(bounds: MessagingSocialBounds) {
  z.number().int().positive().safe().parse(bounds.batchActors);
  const command = { version: z.literal(1), requestId: idSchema };
  const scoped = { ...command, channelId: idSchema };
  const generation = z.number().int().positive().safe();
  const actors = z
    .array(idSchema)
    .min(1)
    .max(bounds.batchActors)
    .refine((ids) => new Set(ids).size === ids.length);
  return {
    dmResult: messagingDmResultSchema,
    closedDmResult: messagingDmDecisionResultSchema,
    previewDmResult: z.strictObject({
      version: z.literal(1),
      channelId: idSchema,
      senderActorId: idSchema,
      introduction: messagingTextSchema(bounds.introductionUnits).nullable(),
      requestedAt: z.iso.datetime(),
    }),
    blockResult: z.strictObject({
      version: z.literal(1),
      blocked: z.boolean(),
      revision: z.number().int().positive().safe(),
    }),
    block: z.strictObject({
      ...command,
      otherActorId: idSchema,
      blocked: z.boolean(),
    }),
    requestDm: z.strictObject({
      ...command,
      recipientActorId: idSchema,
      introduction: messagingTextSchema(bounds.introductionUnits).optional(),
    }),
    previewDm: z.strictObject({ version: z.literal(1), channelId: idSchema }),
    decideDm: z.strictObject({
      ...scoped,
      decision: z.enum(['accept', 'decline', 'cancel']),
    }),
    groupResult: z.strictObject({
      version: z.literal(1),
      channelId: idSchema,
      lifecycle: z.enum(['active', 'archived']),
    }),
    invitationResult: messagingGroupInvitationResultSchema,
    readGroupInvitation: z.strictObject({
      version: z.literal(1),
      channelId: idSchema,
    }),
    cancelGroupInvitation: z.strictObject({
      ...scoped,
      inviteeActorId: idSchema,
      expectedGeneration: generation,
    }),
    createGroup: z.strictObject({
      ...command,
      title: messagingTextSchema(bounds.titleUnits),
      invitedActorIds: actors,
    }),
    inviteGroup: z.strictObject({ ...scoped, invitedActorIds: actors }),
    decideGroupInvitation: z.strictObject({
      ...scoped,
      expectedGeneration: generation,
      decision: z.enum(['accept', 'decline']),
    }),
    removeGroupMember: z.strictObject({ ...scoped, memberActorId: idSchema }),
    leaveGroup: z.strictObject(scoped),
    transferGroup: z.strictObject({ ...scoped, managerActorId: idSchema }),
    archiveGroup: z.strictObject(scoped),
  };
}
