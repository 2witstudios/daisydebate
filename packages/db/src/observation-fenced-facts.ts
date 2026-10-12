import type { ObservationAuthorityContext } from './observation-contracts';
type Fact = ObservationAuthorityContext['resourceFact'];
type Facts = ReadonlyMap<string, Fact>;
const resourceKey = (fact: Exclude<Fact, { kind: 'messaging_collection' }>) =>
  `${fact.kind}:${fact.kind === 'channel' ? fact.channelId : fact.kind === 'room' ? fact.roomId : fact.roundId}`;
/** Current facts must be for the exact parent rows actually locked, including newly present targets. */
export function observationFactsWereFenced(
  facts: Facts,
  fenced: ReadonlySet<string>,
) {
  return [...facts.values()].every(
    (f) => f.kind === 'messaging_collection' || fenced.has(resourceKey(f)),
  );
}
function signature(facts: Facts) {
  return JSON.stringify(
    [...facts.entries()]
      .map(([key, f]) => [
        key,
        f.kind,
        f.kind === 'channel'
          ? f.authority.kind === 'dm'
            ? [f.authority.lowActorId, f.authority.highActorId]
            : [...f.authority.activeMemberActorIds].sort()
          : null,
      ])
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
  );
}
export const sameObservationFactSet = (discovered: Facts, current: Facts) =>
  signature(discovered) === signature(current);
