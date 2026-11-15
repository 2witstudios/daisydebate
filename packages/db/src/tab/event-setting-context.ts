import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { lobbies } from '../schema/lobbies';
import { events } from '../schema/events';
import { organizations } from '../schema/organizations';
import { templates } from '../schema/templates';
import { settings } from '../schema/settings';
import { formatRevisions } from '../schema/format-revisions';
import { formatPresets } from '../schema/format-presets';
import { scopeTransaction, type TenantScope } from '../tenant-scope';
import type { TabTransaction } from './tab-transaction';

/** The named setting parents changed while the command waited for their fences. */
export class EventSettingParentsChanged extends Error {}

/**
 * A consumer reads only its actual chain, addressed by lobby and event. Shared
 * parent locks coexist with other consumers and conflict with the existing
 * settings writers' metadata locks. It never enumerates unrelated lobbies or their records.
 */
export const lockEventSettingContext = async (
  tx: TabTransaction,
  input: {
    readonly lobbyId: string;
    readonly eventId: string;
    readonly subjectUserId: string;
    readonly extraOrganizationIds?: readonly string[];
  },
) => {
  const [foundLobby] = await tx
    .select()
    .from(lobbies)
    .where(eq(lobbies.id, input.lobbyId));
  const scope: TenantScope = {
    subjectUserId: input.subjectUserId,
    lobbyId: foundLobby?.id,
    organizationId: foundLobby?.ownerOrganizationId ?? undefined,
  };
  await scopeTransaction(tx, scope);
  const [foundEvent] = await tx
    .select()
    .from(events)
    .where(
      and(eq(events.id, input.eventId), eq(events.lobbyId, input.lobbyId)),
    );
  if (!foundLobby || !foundEvent) return null;
  const [foundTemplate] = foundEvent.templateId
    ? await tx
        .select()
        .from(templates)
        .where(eq(templates.id, foundEvent.templateId))
    : [];
  const chainOrganizationIds = [
    ...new Set(
      [foundLobby.ownerOrganizationId, foundTemplate?.organizationId].filter(
        (id): id is string => typeof id === 'string',
      ),
    ),
  ].sort();
  const organizationIds = [
    ...new Set([
      ...chainOrganizationIds,
      ...(input.extraOrganizationIds ?? []),
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
  if (foundTemplate)
    await scopeTransaction(tx, {
      ...scope,
      organizationId: foundTemplate.organizationId,
    });
  const [template] = foundTemplate
    ? await tx
        .select()
        .from(templates)
        .where(eq(templates.id, foundTemplate.id))
        .for('share')
    : [];
  await scopeTransaction(tx, scope);
  const [lobby] = await tx
    .select()
    .from(lobbies)
    .where(eq(lobbies.id, foundLobby.id))
    .for('update');
  const [event] = await tx
    .select()
    .from(events)
    .where(and(eq(events.id, foundEvent.id), eq(events.lobbyId, foundLobby.id)))
    .for('update');
  if (
    !lobby ||
    !event ||
    lobby.ownerOrganizationId !== foundLobby.ownerOrganizationId ||
    event.templateId !== foundEvent.templateId ||
    template?.organizationId !== foundTemplate?.organizationId
  )
    throw new EventSettingParentsChanged();
  if (event.templateId !== null && !template)
    throw createAppError('INVARIANT', 'The followed event template is missing');
  const [definition] = await tx
    .select()
    .from(formatRevisions)
    .where(
      and(
        eq(formatRevisions.formatId, event.formatId),
        eq(formatRevisions.version, event.formatVersion),
      ),
    );
  const [preset] = await tx
    .select()
    .from(formatPresets)
    .where(
      and(
        eq(formatPresets.formatId, event.formatId),
        eq(formatPresets.formatVersion, event.formatVersion),
      ),
    )
    .orderBy(desc(formatPresets.version))
    .limit(1)
    .for('share');
  if (!definition || !preset)
    throw createAppError(
      'INVARIANT',
      'Pinned event format has no approved settings',
    );
  const rows = await tx
    .select()
    .from(settings)
    .where(
      or(
        eq(settings.lobbyId, lobby.id),
        eq(settings.eventId, event.id),
        ...(chainOrganizationIds.length
          ? [inArray(settings.organizationId, chainOrganizationIds)]
          : []),
        ...(template ? [eq(settings.templateId, template.id)] : []),
      ),
    );
  return {
    scope,
    lobby,
    event,
    template: template ?? null,
    rows,
    definition,
    preset,
  };
};
export type EventSettingContext = NonNullable<
  Awaited<ReturnType<typeof lockEventSettingContext>>
>;
