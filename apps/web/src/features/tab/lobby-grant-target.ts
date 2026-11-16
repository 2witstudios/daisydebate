import { idSchema, parseUsername } from '@daisy/protocol';
import type { LobbyPeopleView } from '@daisy/protocol/lobby/lobby-people-read';
import type { DiscoverActor } from '../account/username-discovery';
import type { TabPrincipal } from './tab-principal';

export type LobbyGrantTargetInput = {
  readonly lobbyId: string;
  readonly expectedVersion: number;
  readonly username: string;
};

type PeopleAccess = Pick<LobbyPeopleView, 'lobbyId' | 'version'> & {
  readonly capabilities: Pick<LobbyPeopleView['capabilities'], 'give'>;
};

export type LobbyGrantTargetDependencies = {
  readonly readPeople: (
    principal: TabPrincipal,
    lobbyId: string,
  ) => Promise<PeopleAccess | null>;
  readonly discover: DiscoverActor;
  readonly userIdOfActor: (actorId: string) => Promise<string | null>;
};

/** Resolve a grant recipient only after current lobby authority and guard hold. */
export async function resolveLobbyGrantTarget(
  principal: TabPrincipal,
  input: LobbyGrantTargetInput,
  dependencies: LobbyGrantTargetDependencies,
): Promise<string | null> {
  if (
    principal.actorId === null ||
    !idSchema.safeParse(input.lobbyId).success ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 1
  )
    return null;
  const people = await dependencies.readPeople(principal, input.lobbyId);
  if (
    people === null ||
    people.lobbyId !== input.lobbyId ||
    people.version !== input.expectedVersion ||
    !people.capabilities.give
  )
    return null;
  const parsed = parseUsername(input.username);
  if (!parsed.ok) return null;
  const actorId = await dependencies.discover(
    principal.actorId,
    parsed.username,
  );
  return actorId === null ? null : dependencies.userIdOfActor(actorId);
}
