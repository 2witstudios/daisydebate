import { decideObservationBinding } from './observation-authority-decision';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema, observationDescriptorSchema } from '@daisy/protocol';
import { readAuthorizationActors } from './authorization';
import { authorizationAgeFacts } from './authorization-age-batch';
import {
  observationFacts,
  observationDependencies,
  fenceObservationResources,
} from './observation-facts';
import {
  observationSessions,
  observationCurrentHeaders,
} from './observation-authority-state';
import type {
  DecideObservationAuthority,
  ObservationBinding,
  ObservationAuthorityResult,
} from './observation-contracts';

class CastChanged extends Error {}
type Owner = Pick<BunSQLDatabase, 'transaction'>;
function checkedBindings(bindings: readonly ObservationBinding[]) {
  if (
    bindings.length < 1 ||
    bindings.length > 256 ||
    bindings.some(
      (b) =>
        ![b.principal.userId, b.principal.actorId, b.principal.sessionId].every(
          (id) => idSchema.safeParse(id).success,
        ) ||
        !observationDescriptorSchema.safeParse({
          resource: b.resource,
          window: b.window,
        }).success,
    )
  )
    throw createAppError('VALIDATION');
}
const castSignature = (facts: Awaited<ReturnType<typeof observationFacts>>) =>
  JSON.stringify(
    [...facts.entries()]
      .filter(([, f]) => f.kind === 'channel')
      .map(([key, f]) => [
        key,
        f.kind === 'channel'
          ? f.authority.kind === 'dm'
            ? [f.authority.lowActorId, f.authority.highActorId]
            : f.authority.activeMemberActorIds
          : null,
      ])
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
  );
/** Named read operations own discovery, complete ordered fences, fresh time, retry and policy. */
export function createObservationAuthorityOperations(
  owners: { admission: Owner; renewal: Owner },
  decide: DecideObservationAuthority,
) {
  const read = async (
    owner: Owner,
    bindings: readonly ObservationBinding[],
  ): Promise<readonly ObservationAuthorityResult[]> => {
    checkedBindings(bindings);
    for (let attempt = 0; attempt < 3; attempt++)
      try {
        return await owner.transaction(
          async (tx) => {
            const discovered = await observationFacts(tx, bindings);
            const dependencies = observationDependencies(bindings, discovered);
            const locked = await readAuthorizationActors(
              tx,
              dependencies.actors,
              { maxActors: 4096 },
            );
            await fenceObservationResources(tx, bindings, dependencies.pairs);
            const current = await observationFacts(tx, bindings);
            if (castSignature(current) !== castSignature(discovered))
              throw new CastChanged();
            const [edge] = await tx.execute(
              sql`select clock_timestamp() as now`,
            );
            if (
              !(edge?.now instanceof Date) ||
              !Number.isFinite(edge.now.getTime())
            )
              throw createAppError('INFRASTRUCTURE');
            const databaseNow = edge.now.toISOString();
            const accounts = new Map(
              locked.flatMap((a) =>
                a?.actorId ? [[a.actorId, a] as const] : [],
              ),
            );
            const sessions = await observationSessions(
              tx,
              bindings,
              databaseNow,
              accounts,
            );
            const socialIds = new Set(
              [...current.values()].flatMap((f) =>
                f.kind === 'channel'
                  ? f.authority.kind === 'dm'
                    ? [f.authority.lowActorId, f.authority.highActorId]
                    : f.authority.activeMemberActorIds
                  : [],
              ),
            );
            const social = await authorizationAgeFacts(
              tx,
              [...accounts.values()].filter(
                (a) => a.actorId && socialIds.has(a.actorId),
              ),
              databaseNow,
            );
            const byActor = new Map(
              social.map((row) => [row.account.actorId, row]),
            );
            const headers = await observationCurrentHeaders(tx, bindings);
            const state = {
              accounts,
              sessions,
              facts: current,
              headers,
              social: byActor,
              databaseNow,
            };
            return bindings.map((binding) =>
              decideObservationBinding(binding, state, decide),
            );
          },
          { isolationLevel: 'read committed' },
        );
      } catch (error) {
        if (error instanceof CastChanged && attempt < 2) continue;
        return bindings.map(() => ({ status: 'unavailable' }) as const);
      }
    return bindings.map(() => ({ status: 'unavailable' }) as const);
  };
  return {
    admitObservationAuthorityBatch: (bindings: readonly ObservationBinding[]) =>
      read(owners.admission, bindings),
    renewObservationAuthorityBatch: (bindings: readonly ObservationBinding[]) =>
      read(owners.renewal, bindings),
  };
}
