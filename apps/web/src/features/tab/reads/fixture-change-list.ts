import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import type { FixtureChange } from '@daisy/protocol/lobby/command';
import {
  fixtureChangeReadCatalogue,
  type FixtureChangeList,
} from '@daisy/protocol/lobby/fixture-change-read';
import { gatedRead, type LoadedRead } from './gated-read';

/**
 * The `FixtureChangeList` read (TAB-5.22): one page of a tab round's fixture
 * changes, cut for the viewer. An official (whoever may read the lobby as a
 * host) sees every change; anyone else sees only the changes whose people
 * include them or a ward, each naming only those people.
 */

export type FixtureChangeListFacts = {
  readonly tabRoundId: string;
  /** One page of stored changes, oldest first. */
  readonly changes: readonly FixtureChange[];
  readonly nextCursor: string | null;
  /** The viewer's own actors and those of the people they are guardian to. */
  readonly viewerActorIds: readonly string[];
};

/** The one projection: what this viewer is told of the page. */
export const fixtureChangeListOf = (
  facts: FixtureChangeListFacts,
  official: boolean,
): FixtureChangeList => {
  const page = { tabRoundId: facts.tabRoundId, nextCursor: facts.nextCursor };
  if (official) return { seen: 'all', ...page, changes: [...facts.changes] };
  const mine = new Set(facts.viewerActorIds);
  return {
    seen: 'touching',
    ...page,
    changes: facts.changes.flatMap((change) => {
      const people = change.people.filter((actorId) => mine.has(actorId));
      return people.length === 0 ? [] : [{ ...change, people }];
    }),
  };
};

export const readFixtureChangeList = (
  authorize: (input: AuthorizationInput) => AuthorizationDecision,
  load: () => Promise<LoadedRead<FixtureChangeListFacts> | null>,
): Promise<FixtureChangeList | null> =>
  gatedRead(
    authorize,
    fixtureChangeReadCatalogue.FixtureChangeList,
    load,
    (facts, ask) => fixtureChangeListOf(facts, ask('lobby.host.read')),
  );
