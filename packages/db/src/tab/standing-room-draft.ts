import { ladders } from '../schema/ladders';
import { poolResolutions } from '../schema/resolution-pools';
import { formatRevisions } from '../schema/format-revisions';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { fenceTabAccountRead } from './account-read-fence';
import { lobbies } from '../schema/lobbies';
import { organizations } from '../schema/organizations';
import { lobbyTemplates, templates } from '../schema/templates';
import { formatPresets } from '../schema/format-presets';
import { settings } from '../schema/settings';
import { scopeTransaction } from '../tenant-scope';
import { loadAuthorityContext } from './authority-context';
import { loadTemplateRows } from './setting-definition-rows';
import { inTransaction, type Tx, type TxOpener } from '../tx';

type Input = { readonly viewerUserId: string; readonly lobbyId: string };
const offeredTemplates = (tx: Tx, lobbyId: string) =>
  tx
    .select({ templateId: lobbyTemplates.templateId })
    .from(lobbyTemplates)
    .where(
      and(
        eq(lobbyTemplates.lobbyId, lobbyId),
        isNull(lobbyTemplates.withdrawnAt),
      ),
    )
    .orderBy(asc(lobbyTemplates.templateId));

/** Only the addressed standing lobby and its actually offered definitions, under shared fences. */
export const loadStandingRoomDraft = async (tx: Tx, input: Input) => {
  await scopeTransaction(tx, { subjectUserId: input.viewerUserId });
  await fenceTabAccountRead(tx, input.viewerUserId);
  const [found] = await tx
    .select()
    .from(lobbies)
    .where(and(eq(lobbies.id, input.lobbyId), eq(lobbies.kind, 'standing')));
  if (!found?.ownerOrganizationId) return null;
  const scope = {
    subjectUserId: input.viewerUserId,
    organizationId: found.ownerOrganizationId,
    lobbyId: found.id,
  };
  await scopeTransaction(tx, scope);
  const offered = await offeredTemplates(tx, found.id);
  const ids = offered.map((row) => row.templateId);
  const initialTemplates = ids.length ? await loadTemplateRows(tx, ids) : [];
  const organizationIds = [
    ...new Set([
      found.ownerOrganizationId,
      ...initialTemplates.map((row) => row.organizationId),
    ]),
  ].sort();
  for (const organizationId of organizationIds) {
    await scopeTransaction(tx, { ...scope, organizationId });
    await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .for('share');
  }
  for (const row of [...initialTemplates].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    await scopeTransaction(tx, {
      ...scope,
      organizationId: row.organizationId,
    });
    await tx
      .select({ id: templates.id })
      .from(templates)
      .where(eq(templates.id, row.id))
      .for('share');
  }
  await scopeTransaction(tx, scope);
  const [lobby] = await tx
    .select()
    .from(lobbies)
    .where(eq(lobbies.id, found.id))
    .for('share');
  const currentOffers = await offeredTemplates(tx, found.id);
  const currentTemplates = ids.length ? await loadTemplateRows(tx, ids) : [];
  // An offer/owner can change while an earlier parent lock waits. Refuse this
  // obsolete chain rather than read a newly reached definition without its fence.
  if (
    !lobby ||
    lobby.kind !== 'standing' ||
    lobby.ownerOrganizationId !== found.ownerOrganizationId ||
    currentOffers.length !== offered.length ||
    currentOffers.some(
      (row, index) => row.templateId !== offered[index]?.templateId,
    ) ||
    currentTemplates.length !== initialTemplates.length ||
    currentTemplates.some(
      (row) =>
        row.organizationId !==
        initialTemplates.find((one) => one.id === row.id)?.organizationId,
    )
  )
    return null;
  const templateAuthorizations = [];
  for (const organizationId of organizationIds) {
    const organizationScope = { ...scope, organizationId };
    await scopeTransaction(tx, organizationScope);
    templateAuthorizations.push({
      organizationId,
      authorization: await loadAuthorityContext(
        tx,
        organizationScope,
        input.viewerUserId,
        'share',
      ),
    });
  }
  await scopeTransaction(tx, scope);
  const ownerAuthority = templateAuthorizations.find(
    (row) => row.organizationId === lobby.ownerOrganizationId,
  );
  if (!ownerAuthority) return null;
  const { authorization } = ownerAuthority;
  const presets = currentTemplates.length
    ? await tx
        .select()
        .from(formatPresets)
        .where(
          or(
            ...currentTemplates.map((row) =>
              and(
                eq(formatPresets.formatId, row.formatId),
                eq(formatPresets.formatVersion, row.formatVersion),
              ),
            ),
          ),
        )
        .for('share')
    : [];
  // A league's Rooms are in its division (ADR 0156); Daisy runs every
  // division and carries none, so its own standing Rooms are Open.
  const [owner] = await tx
    .select({ division: organizations.leagueDivision })
    .from(organizations)
    .where(eq(organizations.id, found.ownerOrganizationId));
  return {
    lobby,
    authorization,
    offered: currentOffers,
    division: owner?.division ?? ('open' as const),
    templateAuthorizations,
    ladder:
      (
        await tx
          .select({ id: ladders.id })
          .from(ladders)
          .where(eq(ladders.lobbyId, lobby.id))
      )[0] ?? null,
    resolutions: await tx
      .select()
      .from(poolResolutions)
      .where(
        and(
          isNull(poolResolutions.retiredAt),
          or(
            eq(poolResolutions.organizationId, lobby.ownerOrganizationId),
            eq(poolResolutions.lobbyId, lobby.id),
          ),
        ),
      )
      .orderBy(asc(poolResolutions.id)),
    definitions: currentTemplates.length
      ? await tx
          .select()
          .from(formatRevisions)
          .where(
            or(
              ...currentTemplates.map((template) =>
                and(
                  eq(formatRevisions.formatId, template.formatId),
                  eq(formatRevisions.version, template.formatVersion),
                ),
              ),
            ),
          )
      : [],
    graph: {
      templates: currentTemplates,
      organizations: await tx
        .select()
        .from(organizations)
        .where(inArray(organizations.id, organizationIds)),
      settings: await tx
        .select()
        .from(settings)
        .where(
          or(
            // Parent ids also isolate child-scope rows; they do not make those
            // unrelated children part of this Room's setting chain.
            and(
              eq(settings.scopeKind, 'organization'),
              eq(settings.organizationId, scope.organizationId),
            ),
            and(
              eq(settings.scopeKind, 'lobby'),
              eq(settings.lobbyId, lobby.id),
            ),
            ...(ids.length ? [inArray(settings.templateId, ids)] : []),
          ),
        ),
      presets,
    },
  };
};
export type StandingRoomDraftFacts = NonNullable<
  Awaited<ReturnType<typeof loadStandingRoomDraft>>
>;
export const createStandingRoomDraftStore = (database: TxOpener) => ({
  standingRoomDraft: <Answer>(
    input: Input,
    work: (facts: StandingRoomDraftFacts | null) => Promise<Answer>,
  ): Promise<Answer> =>
    inTransaction(database, async (tx) =>
      work(await loadStandingRoomDraft(tx, input)),
    ),
});
