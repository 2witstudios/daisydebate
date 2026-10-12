import { z } from 'zod';
import { idSchema } from './primitives';

export const observationResourceSchema = z.strictObject({
  kind: z.enum(['room', 'round', 'channel', 'inbox']),
  id: idSchema,
});
export const observationPartitionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('shared'),
    policyKey: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  }),
  z.strictObject({ kind: z.literal('actor'), actorId: idSchema }),
]);
const revision = z.number().int().nonnegative().safe();
export const observationWindowSchema = z.strictObject({
  after: idSchema.nullable(),
  limit: z.number().int().min(1).max(50),
});
/** Policy composition issues partitions; parsing or possessing a base never grants access. */
export const observationBaseSchema = z
  .strictObject({
    schema: z.literal(1),
    resource: observationResourceSchema,
    partition: observationPartitionSchema,
    disclosureRevision: revision,
    window: observationWindowSchema,
  })
  .refine(
    ({ resource, partition }) =>
      resource.kind !== 'inbox' ||
      (partition.kind === 'actor' && partition.actorId === resource.id),
    { message: 'Inbox partition must name its actor' },
  );
export const observationHeaderSchema = z.strictObject({
  resource: observationResourceSchema,
  contentRevision: revision,
  disclosureRevision: revision,
  purgeGeneration: revision,
});
export type ObservationResource = z.infer<typeof observationResourceSchema>;
export type ObservationPartition = z.infer<typeof observationPartitionSchema>;
export type ObservationBase = z.infer<typeof observationBaseSchema>;
export type ObservationHeader = z.infer<typeof observationHeaderSchema>;
export function observationResourceKey(resource: ObservationResource): string {
  const parsed = observationResourceSchema.parse(resource);
  return `${parsed.kind}-${parsed.id}`;
}
/** Unambiguous stable identity; evidence timestamps and acquisition attempts cannot enter it. */
export function observationBaseKey(base: ObservationBase): string {
  const value = observationBaseSchema.parse(base);
  return JSON.stringify([
    value.schema,
    value.resource.kind,
    value.resource.id,
    value.partition.kind,
    value.partition.kind === 'actor'
      ? value.partition.actorId
      : value.partition.policyKey,
    value.disclosureRevision,
    value.window.after,
    value.window.limit,
  ]);
}
export const observationFrameBytes = 128 * 1024;
export function createObservationSnapshotSchema<T extends z.ZodType>(body: T) {
  return z.strictObject({
    base: observationBaseSchema,
    contentRevision: revision,
    purgeGeneration: revision,
    body,
  });
}
