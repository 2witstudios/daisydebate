import { eq } from 'drizzle-orm';
import { formats } from '../schema/formats';
import { formatRevisions } from '../schema/format-revisions';
import { organizations } from '../schema/organizations';
import { templates } from '../schema/templates';
import { ballotDefinitions } from '../schema/ballot-definitions';
import type { TabTransaction } from './tab-transaction';

/** Format definitions and their approved settings, at the pinned revision. */
export const loadFormatRows = (tx: TabTransaction) =>
  tx
    .select({
      formatId: formatRevisions.formatId,
      version: formatRevisions.version,
      definition: formatRevisions.definition,
      organizationId: formats.organizationId,
      name: formats.name,
      createdByActorId: formats.createdByActorId,
    })
    .from(formatRevisions)
    .innerJoin(formats, eq(formats.id, formatRevisions.formatId));

/** Templates keep their pins and their owner's name, including after retirement. */
export const loadTemplateRows = (tx: TabTransaction) =>
  tx
    .select({
      id: templates.id,
      organizationId: templates.organizationId,
      organizationName: organizations.name,
      name: templates.name,
      formatId: templates.formatId,
      formatVersion: templates.formatVersion,
      formatName: formats.name,
      ballotDefinitionId: templates.ballotDefinitionId,
      ballotDefinitionVersion: templates.ballotDefinitionVersion,
      ballotDefinitionName: ballotDefinitions.name,
      retiredAt: templates.retiredAt,
      version: templates.version,
      settingsVersion: templates.settingsVersion,
    })
    .from(templates)
    .innerJoin(organizations, eq(organizations.id, templates.organizationId))
    .innerJoin(formats, eq(formats.id, templates.formatId))
    .leftJoin(
      ballotDefinitions,
      eq(ballotDefinitions.id, templates.ballotDefinitionId),
    );
