import { z } from 'zod';
import { idSchema } from '../primitives';
import { messagingTextSchema } from './core';

export type MessagingSocialBounds = Readonly<{
  introductionUnits: number;
  titleUnits: number;
  batchActors: number;
}>;

/** Actor comes from the principal; contact facts never come from a command. */
export function createMessagingSocialSchemas(bounds: MessagingSocialBounds) {
  z.number().int().positive().safe().parse(bounds.batchActors);
  const command = { version: z.literal(1), requestId: idSchema };
  const scoped = { ...command, channelId: idSchema };
  const actors = z
    .array(idSchema)
    .min(1)
    .max(bounds.batchActors)
    .refine((ids) => new Set(ids).size === ids.length);
  return {
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
    decideDm: z.strictObject({
      ...scoped,
      decision: z.enum(['accept', 'decline', 'cancel']),
    }),
    createGroup: z.strictObject({
      ...command,
      title: messagingTextSchema(bounds.titleUnits),
      invitedActorIds: actors,
    }),
    inviteGroup: z.strictObject({ ...scoped, invitedActorIds: actors }),
    decideGroupInvitation: z.strictObject({
      ...scoped,
      decision: z.enum(['accept', 'decline']),
    }),
    removeGroupMember: z.strictObject({ ...scoped, memberActorId: idSchema }),
    leaveGroup: z.strictObject(scoped),
    transferGroup: z.strictObject({ ...scoped, managerActorId: idSchema }),
    archiveGroup: z.strictObject(scoped),
  };
}
