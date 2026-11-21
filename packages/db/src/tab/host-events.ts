import { poolResolutions } from '../schema/resolution-pools';
import { draws } from '../schema/draws';
import { releases } from '../schema/releases';
import { and, eq, isNull, or, inArray } from 'drizzle-orm';
import { loadFormatCatalogue } from '../format-catalogue';
import { formatRevisions } from '../schema/format-revisions';
import { formatPresets } from '../schema/format-presets';
import { formats } from '../schema/formats';
import { templates } from '../schema/templates';
import { organizations } from '../schema/organizations';
import { readDatabaseTime } from '../database-clock';
import { loadTournamentSetupFacts } from './tournament-setup-read';
import type { TabDatabase, TabTransaction } from './tab-transaction';

type Input = { readonly viewerUserId: string; readonly lobbyId: string };
async function load(tx: TabTransaction, input: Input) {
  const setup = await loadTournamentSetupFacts(tx, input);
  if (!setup) return null;
  const actorId = setup.authorization.account?.actorId;
  const owned =
    !actorId && !setup.lobby.ownerOrganizationId
      ? []
      : await tx
          .select({
            id: formats.id,
            name: formats.name,
            version: formats.currentVersion,
          })
          .from(formats)
          .innerJoin(
            formatRevisions,
            and(
              eq(formatRevisions.formatId, formats.id),
              eq(formatRevisions.version, formats.currentVersion),
            ),
          )
          .innerJoin(
            formatPresets,
            and(
              eq(formatPresets.formatId, formats.id),
              eq(formatPresets.formatVersion, formats.currentVersion),
              isNull(formatPresets.supersededAt),
            ),
          )
          .where(
            or(
              ...(actorId ? [eq(formats.createdByActorId, actorId)] : []),
              ...(setup.lobby.ownerOrganizationId
                ? [
                    and(
                      isNull(formats.createdByActorId),
                      eq(
                        formats.organizationId,
                        setup.lobby.ownerOrganizationId,
                      ),
                    ),
                  ]
                : []),
            ),
          );
  const catalogue = await loadFormatCatalogue(tx);
  const followed = await tx
    .select({
      id: templates.id,
      name: templates.name,
      organizationName: organizations.name,
      formatId: templates.formatId,
      formatVersion: templates.formatVersion,
    })
    .from(templates)
    .innerJoin(organizations, eq(organizations.id, templates.organizationId))
    .where(
      and(
        isNull(templates.retiredAt),
        or(
          eq(templates.shared, true),
          ...(setup.lobby.ownerOrganizationId
            ? [eq(templates.organizationId, setup.lobby.ownerOrganizationId)]
            : []),
        ),
      ),
    );
  return {
    setup,
    checkedAt: (await readDatabaseTime(tx)).toISOString(),
    formats: [
      ...new Map(
        [...catalogue, ...owned].map((row) => [
          `${row.id}:${row.version}`,
          { id: row.id, name: row.name, version: row.version },
        ]),
      ).values(),
    ],
    templates: followed,
    publishedRounds: await tx
      .select({ id: draws.tabRoundId })
      .from(draws)
      .where(
        and(eq(draws.lobbyId, setup.lobby.id), eq(draws.status, 'published')),
      ),
    postingReleases: await tx
      .select({ tabRoundId: releases.tabRoundId, audience: releases.audience })
      .from(releases)
      .where(
        and(
          eq(releases.lobbyId, setup.lobby.id),
          eq(releases.thing, 'posting'),
        ),
      ),
    resolutions: setup.pools.length
      ? await tx
          .select()
          .from(poolResolutions)
          .where(
            and(
              inArray(
                poolResolutions.poolId,
                setup.pools.map((pool) => pool.id),
              ),
              isNull(poolResolutions.retiredAt),
            ),
          )
      : [],
  };
}
export type HostEventsFacts = NonNullable<Awaited<ReturnType<typeof load>>>;
export const createHostEventsStore = (database: TabDatabase) => ({
  hostEvents: <Answer>(
    input: Input,
    work: (facts: HostEventsFacts | null) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) => work(await load(tx, input))),
});
