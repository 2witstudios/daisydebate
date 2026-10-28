import { z } from 'zod';
import { idSchema } from './primitives';

/**
 * Shared resource observation (ADR 0089). A resource kind is named by the
 * feature concept that owns it; adopting a new kind (a Round spectator view)
 * adds one entry here and one server definition, nothing else.
 */
const observationResourceKinds = ['channel-messages'] as const;
export type ObservationResourceKind = (typeof observationResourceKinds)[number];

const observationResourceSchema = z.strictObject({
  kind: z.enum(observationResourceKinds),
  id: idSchema,
});
export type ObservationResource = z.infer<typeof observationResourceSchema>;

/** A whole socket frame, envelope included (repair plan §4). */
export const observationFrameBytes = 128 * 1024;
/** A viewer-private overlay riding beside a shared body. */
const observationOverlayBytes = 64 * 1024;
/** Items in one hot window; older history is an explicit HTTP read. */
export const observationWindowItems = 50;
/** DEC-130: a permit lives at most 4,700ms past its read start (300ms reserve under 5s). */
export const observationPermitMs = 4_700;

const revision = z.number().int().nonnegative().safe();
const generation = z.number().int().nonnegative().safe();
/** A policy-issued visibility partition label; equal labels disclose identical fields. */
const observationPartitionSchema = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);

/**
 * One stable identity per resource, safe as a Redis key segment and a Pub/Sub
 * channel name. It names the resource only: possessing it grants nothing.
 */
export function observationResourceKey(resource: ObservationResource): string {
  const { kind, id } = observationResourceSchema.parse(resource);
  return `${kind}_${id}`;
}

/** Inverse of `observationResourceKey`; null for anything it did not produce. */
export function parseObservationResourceKey(
  key: string,
): ObservationResource | null {
  const at = key.lastIndexOf('_');
  const parsed = observationResourceSchema.safeParse({
    kind: key.slice(0, at),
    id: key.slice(at + 1),
  });
  return at > 0 && parsed.success ? parsed.data : null;
}

/**
 * The projection base: resource + partition + durable disclosure revision.
 * The body cache key is base + content revision; permits are never part of it.
 */
export type ObservationBase = {
  readonly resource: ObservationResource;
  readonly partition: string;
  readonly disclosureRevision: number;
};
export const observationBaseSchema = z.strictObject({
  resource: observationResourceSchema,
  partition: observationPartitionSchema,
  disclosureRevision: revision,
});
/** Redis-safe base digest within one resource scope. */
export function observationBaseField(base: ObservationBase): string {
  const parsed = observationBaseSchema.parse(base);
  return `${parsed.partition}.${parsed.disclosureRevision}`;
}

/** UTF-8 length of the JSON encoding, independent of a host TextEncoder. */
export function observationJsonBytes(value: unknown): number {
  return utf8Bytes(JSON.stringify(value) ?? '');
}
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const point = char.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

const observationOverlaySchema = z
  .json()
  .refine((value) => observationJsonBytes(value) <= observationOverlayBytes, {
    message: 'Observation overlay exceeds its byte bound',
  });

/** Client → server: interest in one resource on this socket. */
export function buildObservationClientMessages<V extends number>(
  envelope: { readonly v: z.ZodLiteral<V> },
  requestId: z.ZodString,
) {
  const request = { ...envelope, id: requestId };
  return [
    z.strictObject({
      ...request,
      type: z.literal('observe'),
      resource: observationResourceSchema,
    }),
    z.strictObject({
      ...request,
      type: z.literal('unobserve'),
      resource: observationResourceSchema,
    }),
  ] as const;
}

/**
 * Server → client. `ready` binds a permit generation to a base and a minimum
 * content revision; `snapshot` replaces the window monotonically within that
 * base; `state` reports denial, unavailability, degradation or revocation.
 * A `ready` or `state` of an older generation is stale and ignored by the
 * provider; a snapshot applies only to the current `ready`'s base.
 */
export function buildObservationServerMessages<V extends number>(
  envelope: { readonly v: z.ZodLiteral<V> },
  requestId: z.ZodString,
) {
  const bound = {
    ...envelope,
    resource: observationResourceSchema,
    generation,
  };
  return [
    z.strictObject({
      ...bound,
      type: z.literal('observation.ready'),
      id: requestId,
      partition: observationPartitionSchema,
      disclosureRevision: revision,
      minimumContentRevision: revision,
      validForMs: z.number().int().min(1).max(observationPermitMs),
      overlay: observationOverlaySchema.optional(),
    }),
    // No generation: one encoded snapshot serves every permitted viewer; the
    // server's synchronous enqueue check is what binds it to a permit.
    z
      .strictObject({
        ...envelope,
        resource: observationResourceSchema,
        type: z.literal('observation.snapshot'),
        partition: observationPartitionSchema,
        disclosureRevision: revision,
        contentRevision: revision,
        body: z.json(),
      })
      .refine((frame) => observationJsonBytes(frame) <= observationFrameBytes, {
        message: 'Observation frame exceeds its byte bound',
      }),
    z.strictObject({
      ...bound,
      type: z.literal('observation.state'),
      id: requestId.optional(),
      state: z.enum(['denied', 'unavailable', 'degraded', 'revoked']),
    }),
  ] as const;
}
