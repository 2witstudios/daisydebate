import { eq, inArray } from 'drizzle-orm';
import { actors } from '../schema/actors';
import { organizations } from '../schema/organizations';
import { scopeTransaction } from '../tenant-scope';
import { fenceTabAccountRead } from './account-read-fence';
import { lockEventSettingContext } from './event-setting-context';
import { loadOrganizationContext } from './organization-context';
import type { TabDatabase, TabTransaction } from './tab-transaction';
type Input = {
  readonly viewerUserId: string;
  readonly lobbyId: string;
  readonly eventId: string;
};
const load = async (tx: TabTransaction, input: Input) => {
  await scopeTransaction(tx, { subjectUserId: input.viewerUserId });
  await fenceTabAccountRead(tx, input.viewerUserId);
  const configuration = await lockEventSettingContext(tx, {
    lobbyId: input.lobbyId,
    eventId: input.eventId,
    subjectUserId: input.viewerUserId,
    strength: 'share',
  });
  if (!configuration) return null;
  const { scope, lobby, template } = configuration;
  const authorization = await loadOrganizationContext(
    tx,
    scope,
    input.viewerUserId,
    'share',
  );
  const [owner] = lobby.ownerUserId
    ? await tx
        .select({ id: actors.id })
        .from(actors)
        .where(eq(actors.userId, lobby.ownerUserId))
    : [];
  const organizationIds = [
    ...new Set(
      [lobby.ownerOrganizationId, template?.organizationId].filter(
        (id): id is string => typeof id === 'string',
      ),
    ),
  ];
  return {
    configuration,
    authorization,
    ownerActorId: owner?.id ?? null,
    organizations: organizationIds.length
      ? await tx
          .select({ id: organizations.id, name: organizations.name })
          .from(organizations)
          .where(inArray(organizations.id, organizationIds))
      : [],
  };
};
export type TournamentEventSettingFacts = NonNullable<
  Awaited<ReturnType<typeof load>>
>;
export const createTournamentEventSettingReadStore = (
  database: TabDatabase,
) => ({
  tournamentEventSettings: <Answer>(
    input: Input,
    work: (facts: TournamentEventSettingFacts | null) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) => work(await load(tx, input))),
});
