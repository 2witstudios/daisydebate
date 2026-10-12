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
  after: z.union([idSchema, z.number().int().positive().safe()]).nullable(),
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
  )
  .refine(
    ({ resource, window }) =>
      observationWindowMatchesResource(resource, window),
    { message: 'Window cursor must match resource' },
  );
export function observationWindowMatchesResource(
  resource: { readonly kind: string },
  window: { readonly after: string | number | null },
) {
  return (
    window.after === null ||
    (resource.kind === 'channel'
      ? typeof window.after === 'number'
      : resource.kind === 'inbox'
        ? typeof window.after === 'string'
        : false)
  );
}
export const observationHeaderSchema = z.strictObject({
  resource: observationResourceSchema,
  contentRevision: revision,
  disclosureRevision: revision,
  purgeGeneration: revision,
});
export const observationDescriptorSchema = z
  .strictObject({
    resource: observationResourceSchema,
    window: observationWindowSchema,
  })
  .refine(({ resource, window }) =>
    observationWindowMatchesResource(resource, window),
  );
export type ObservationDescriptor = z.infer<typeof observationDescriptorSchema>;
export type ObservationWindow = z.infer<typeof observationWindowSchema>;
export type ObservationResource = z.infer<typeof observationResourceSchema>;
export type ObservationPartition = z.infer<typeof observationPartitionSchema>;
export type ObservationBase = z.infer<typeof observationBaseSchema>;
export type ObservationHeader = z.infer<typeof observationHeaderSchema>;
/** One fact an authority decision depends on, partitioned by who shares it. */
export type ObservationDependency = {
  readonly scope: 'subject' | 'cohort' | 'entitlement';
  readonly key: string;
  readonly revision: string;
  readonly nextBoundary: string | null;
};
/** The pure policy result the authority producer turns into evidence. */
export type ObservationAuthorityDecision =
  | {
      readonly status: 'allowed';
      readonly partition: ObservationPartition;
      readonly dependencies: readonly ObservationDependency[];
      readonly eligibleUntil: string | null;
      readonly overlay: unknown;
    }
  | { readonly status: 'denied' | 'unavailable' };
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
/** Kept separate from realtime framing constants to avoid a module cycle. */
export function createObservationClientMessageSchema(version: number) {
  const envelope = { v: z.literal(version), id: z.string().min(1).max(128) };
  return z.discriminatedUnion('type', [
    z
      .strictObject({
        ...envelope,
        type: z.literal('observe'),
        resource: observationResourceSchema,
        window: observationWindowSchema,
      })
      .refine(({ resource, window }) =>
        observationWindowMatchesResource(resource, window),
      ),
    z
      .strictObject({
        ...envelope,
        type: z.literal('unobserve'),
        resource: observationResourceSchema,
        window: observationWindowSchema,
      })
      .refine(({ resource, window }) =>
        observationWindowMatchesResource(resource, window),
      ),
  ]);
}
