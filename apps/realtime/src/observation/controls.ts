import { outboxPayloadSchema } from '@daisy/protocol';

/**
 * The actors a batch of drained outbox rows fences (ADR 0089 §8): a
 * revoked session stops that actor's observation permits synchronously and
 * re-reads them, before the drain's own socket close lands. Content rows
 * fence nothing; a control can only take permission away.
 */
export function actorsFencedBy(
  rows: readonly { readonly payload: unknown }[],
): readonly string[] {
  const actors = new Set<string>();
  for (const row of rows) {
    const payload = outboxPayloadSchema.safeParse(row.payload, {
      jitless: true,
    });
    if (payload.success && payload.data.kind === 'session.revoked')
      actors.add(payload.data.ids[0]!);
  }
  return [...actors];
}
