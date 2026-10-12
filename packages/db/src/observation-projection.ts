import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import {
  observationBaseSchema,
  observationHeaderSchema,
  observationProjectionRowBytes,
  type ObservationBase,
} from '@daisy/protocol';
import { requireCurrentObservation } from './observation-guard';
import type {
  ObservationProjectionInput,
  ObservationProjection,
} from './observation-contracts';
const sharedPartitions = {
  room: 'room-safe-v1',
  round: 'round-clock-v1',
  channel: 'channel-messages-v1',
} as const;
function projectionInput(input: ObservationProjectionInput) {
  const base = observationBaseSchema.safeParse(input.base);
  if (
    !base.success ||
    ![input.minimumContentRevision, input.purgeGeneration].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    )
  )
    throw createAppError('VALIDATION');
  if (
    base.data.resource.kind === 'inbox' ||
    base.data.partition.kind !== 'shared' ||
    base.data.partition.policyKey !== sharedPartitions[base.data.resource.kind]
  )
    throw createAppError('INFRASTRUCTURE', 'Projection producer unavailable');
  return base.data;
}
function projectionRows(
  rows: unknown,
): asserts rows is readonly Record<string, unknown>[] {
  if (
    !Array.isArray(rows) ||
    rows.length > 50 ||
    rows.some((v) => v === null || typeof v !== 'object' || Array.isArray(v))
  )
    throw createAppError('INFRASTRUCTURE', 'Projection unavailable');
  if (
    new TextEncoder().encode(JSON.stringify(rows)).byteLength >
    observationProjectionRowBytes
  )
    throw createAppError('INFRASTRUCTURE', 'Projection unavailable');
}
/** A channel page is the complete fitting prefix; an oversized newest row is unavailable, never skipped. */
function channelPage(page: unknown) {
  const { rows, scanned, included } = (page ?? {}) as Record<string, unknown>;
  projectionRows(rows);
  if (
    typeof scanned !== 'number' ||
    included !== rows.length ||
    (scanned > 0 && rows.length === 0)
  )
    throw createAppError('INFRASTRUCTURE', 'Projection unavailable');
  const last = rows.at(-1)?.sequence;
  if (scanned === rows.length) return { rows, continuation: null };
  if (typeof last !== 'number')
    throw createAppError('INFRASTRUCTURE', 'Projection unavailable');
  return { rows, continuation: last };
}
function projectionRow(
  base: ObservationBase,
  row: Record<string, unknown> | undefined,
): ObservationProjection {
  const header = observationHeaderSchema.safeParse({
    resource: base.resource,
    contentRevision: Number(row?.contentRevision),
    disclosureRevision: Number(row?.disclosureRevision),
    purgeGeneration: Number(row?.purgeGeneration),
  });
  if (!header.success)
    throw createAppError('INFRASTRUCTURE', 'Projection unavailable');
  if (base.resource.kind === 'channel')
    return { base, header: header.data, ...channelPage(row?.rows) };
  const rows = row?.rows;
  projectionRows(rows);
  return { base, header: header.data, rows, continuation: null };
}
/** The role sees fixed restricted producers; header and body share one post-fence MVCC statement. */
export function createObservationProjectionOperations(
  database: Pick<BunSQLDatabase, 'transaction'>,
) {
  return {
    readObservationProjection: async (
      input: ObservationProjectionInput,
    ): Promise<ObservationProjection> => {
      const base = projectionInput(input),
        { kind, id } = base.resource;
      requireCurrentObservation(input);
      return database.transaction(
        async (tx) => {
          requireCurrentObservation(input);
          const [fence] = await tx.execute(
            sql`select public.daisy_observation_projection_fence(${kind},${id}) as locked`,
          );
          requireCurrentObservation(input);
          if (fence?.locked !== true)
            throw createAppError('INFRASTRUCTURE', 'Projection unavailable');
          const body =
            kind === 'room'
              ? sql`public.daisy_observation_room_body(${id})`
              : kind === 'round'
                ? sql`public.daisy_observation_round_body(${id})`
                : sql`public.daisy_observation_channel_body(${id},${base.window.after}::bigint,${base.window.limit},${observationProjectionRowBytes})`;
          const [row] = await tx.execute(
            sql`select content_revision as "contentRevision",disclosure_revision as "disclosureRevision",purge_generation as "purgeGeneration",${body} as rows from public.resource_observation_headers where kind=${kind} and resource_id=${id} and disclosure_revision=${base.disclosureRevision} and purge_generation=${input.purgeGeneration} and content_revision>=${input.minimumContentRevision}`,
          );
          return projectionRow(base, row);
        },
        { isolationLevel: 'read committed' },
      );
    },
  };
}
