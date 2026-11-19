import { entries } from '../schema/entries';
import { eq, inArray, or } from 'drizzle-orm';
import {
  ballotDefinitions,
  ballotDefinitionVersions,
} from '../schema/ballot-definitions';
import { daisyOrganizationId } from '../daisy-reference';
import { loadTournamentEventSettingFacts } from './tournament-event-settings';
import type { TabDatabase } from './tab-transaction';
import { inTransaction, type Tx } from '../tx';

const load = async (
  tx: Tx,
  input: {
    readonly viewerUserId: string;
    readonly lobbyId: string;
    readonly eventId: string;
  },
) => {
  const context = await loadTournamentEventSettingFacts(tx, input);
  if (!context) return null;
  const { lobby, event } = context.configuration;
  // The exact followed pin may be read, but it does not grant that owner's catalogue.
  const definitions = await tx
    .select()
    .from(ballotDefinitions)
    .where(
      or(
        eq(ballotDefinitions.lobbyId, lobby.id),
        eq(ballotDefinitions.organizationId, daisyOrganizationId),
        ...(lobby.ownerOrganizationId
          ? [eq(ballotDefinitions.organizationId, lobby.ownerOrganizationId)]
          : []),
        ...(event.ballotDefinitionId
          ? [eq(ballotDefinitions.id, event.ballotDefinitionId)]
          : []),
      ),
    )
    .for('share');
  const versions = definitions.length
    ? await tx
        .select()
        .from(ballotDefinitionVersions)
        .where(
          inArray(
            ballotDefinitionVersions.ballotDefinitionId,
            definitions.map((row) => row.id),
          ),
        )
    : [];
  const held = await tx
    .select({ id: entries.id })
    .from(entries)
    .where(eq(entries.eventId, event.id))
    .limit(1);
  return { ...context, definitions, versions, entriesExist: held.length > 0 };
};
export type EventBallotFacts = NonNullable<Awaited<ReturnType<typeof load>>>;
export const createEventBallotReadStore = (database: TabDatabase) => ({
  eventBallot: <Answer>(
    input: {
      readonly viewerUserId: string;
      readonly lobbyId: string;
      readonly eventId: string;
    },
    work: (facts: EventBallotFacts | null) => Promise<Answer>,
  ): Promise<Answer> =>
    inTransaction(database, async (tx) => work(await load(tx, input))),
});
