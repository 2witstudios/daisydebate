import {
  observationFactKey,
  assertObservationFactBudget,
} from './observation-fact-boundary';
import { observationParentFacts } from './observation-parent-facts';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { observationResourceKey } from '@daisy/protocol';
import { readMessagingChannelFacts } from './messaging/social';
import type {
  ObservationAuthorityContext,
  ObservationBinding,
} from './observation-contracts';

type Reader = Pick<BunSQLDatabase, 'select' | 'execute'>;
type Fact = ObservationAuthorityContext['resourceFact'];
export async function observationFacts(
  tx: Reader,
  bindings: readonly ObservationBinding[],
) {
  const facts = await observationParentFacts(tx, bindings);
  const channelBindings = bindings.filter((b) => b.resource.kind === 'channel');
  const channels = channelBindings.length
    ? await readMessagingChannelFacts(
        tx,
        channelBindings.map((b) => ({
          channelId: b.resource.id,
          actorId: b.principal.actorId,
        })),
      )
    : [];
  for (const [index, binding] of channelBindings.entries()) {
    const fact = channels[index];
    if (fact) {
      assertObservationFactBudget(
        fact.authority.kind === 'private_group'
          ? fact.authority.activeMemberActorIds.length
          : 2,
      );
      facts.set(observationFactKey(binding), fact);
    }
  }
  for (const binding of bindings.filter((b) => b.resource.kind === 'inbox'))
    if (binding.resource.id === binding.principal.actorId)
      facts.set(observationFactKey(binding), {
        kind: 'messaging_collection',
        actorId: binding.principal.actorId,
      });
  return facts;
}
export function observationDependencies(
  bindings: readonly ObservationBinding[],
  facts: ReadonlyMap<string, Fact>,
) {
  const actors = new Set(bindings.map((b) => b.principal.actorId));
  const pairs = new Map<string, { low: string; high: string }>();
  for (const fact of facts.values())
    if (fact.kind === 'channel') {
      if (fact.authority.kind === 'dm') {
        const { lowActorId: low, highActorId: high } = fact.authority;
        actors.add(low);
        actors.add(high);
        pairs.set(`${low}:${high}`, { low, high });
      } else
        for (const actorId of fact.authority.activeMemberActorIds)
          actors.add(actorId);
    }
  assertObservationFactBudget(actors.size + pairs.size + bindings.length);
  return {
    actors: [...actors].sort(),
    pairs: [...pairs.values()].sort(
      (a, b) => a.low.localeCompare(b.low) || a.high.localeCompare(b.high),
    ),
  };
}
export async function fenceObservationResources(
  tx: Reader,
  bindings: readonly ObservationBinding[],
  pairs: readonly { low: string; high: string }[],
) {
  const resources = [
    ...new Map(
      bindings.map((b) => [observationResourceKey(b.resource), b.resource]),
    ).values(),
  ];
  const rows = await tx.execute(
    sql`select resource_kind as kind,resource_id as id from public.daisy_observation_authority_fences(${JSON.stringify(resources)}::text::jsonb,${JSON.stringify(pairs)}::text::jsonb)`,
  );
  return new Set(rows.map((row) => `${row.kind}:${row.id}`));
}
