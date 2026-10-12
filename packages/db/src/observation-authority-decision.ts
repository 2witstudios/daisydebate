import {
  observationResourceKey,
  type ObservationHeader,
} from '@daisy/protocol';
import { observationFactKey } from './observation-fact-boundary';
import { allowedObservationAuthority } from './observation-authority-state';
import type {
  DecideObservationAuthority,
  ObservationAuthorityContext,
  ObservationAuthorityResult,
  ObservationBinding,
} from './observation-contracts';
type Fact = ObservationAuthorityContext['resourceFact'];
function observationChannelActors(fact: Fact) {
  return fact.kind === 'channel'
    ? fact.authority.kind === 'dm'
      ? [fact.authority.lowActorId, fact.authority.highActorId]
      : fact.authority.activeMemberActorIds
    : [];
}
type State = {
  readonly accounts: ReadonlyMap<
    string,
    ObservationAuthorityContext['account']
  >;
  readonly sessions: ReadonlyMap<
    string,
    ObservationAuthorityContext['session']
  >;
  readonly facts: ReadonlyMap<string, Fact>;
  readonly headers: ReadonlyMap<string, ObservationHeader>;
  readonly social: ReadonlyMap<
    string | null,
    NonNullable<ObservationAuthorityContext['socialAccounts']>[number]
  >;
  readonly databaseNow: string;
};
function matchingSession(
  binding: ObservationBinding,
  session: ObservationAuthorityContext['session'] | undefined,
) {
  return (
    session?.userId === binding.principal.userId &&
    session.actorId === binding.principal.actorId
  );
}
const semanticFact = (fact: Fact, header: ObservationHeader) =>
  fact.kind === 'room' || fact.kind === 'round'
    ? { ...fact, revision: header.disclosureRevision }
    : fact;
export function decideObservationBinding(
  binding: ObservationBinding,
  state: State,
  decide: DecideObservationAuthority,
): ObservationAuthorityResult {
  const account = state.accounts.get(binding.principal.actorId),
    session = state.sessions.get(binding.principal.sessionId),
    fact = state.facts.get(observationFactKey(binding)),
    header = state.headers.get(observationResourceKey(binding.resource));
  if (!account || !session || !matchingSession(binding, session) || !fact)
    return { status: 'denied' };
  if (!header) return { status: 'unavailable' };
  const social = observationChannelActors(fact).map((id) =>
    state.social.get(id),
  );
  if (social.some((row) => !row)) return { status: 'denied' };
  const context: ObservationAuthorityContext = {
    principal: { kind: 'user', ...binding.principal },
    account,
    session,
    resource: binding.resource,
    resourceFact: semanticFact(fact, header),
    databaseNow: state.databaseNow,
    ...(fact.kind === 'channel'
      ? { socialAccounts: social.filter((row) => row !== undefined) }
      : {}),
  };
  const decision = decide(context);
  return decision.status === 'allowed'
    ? allowedObservationAuthority(
        binding,
        session,
        decision,
        header,
        state.databaseNow,
      )
    : decision;
}
