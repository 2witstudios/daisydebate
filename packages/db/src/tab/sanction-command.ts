import { and, eq, or } from 'drizzle-orm';
import type { SanctionCommand } from '@daisy/protocol/lobby/sanction-command';
import type {
  ActionHistoryEntry,
  LobbyCommandReceipt,
} from '@daisy/protocol/lobby/command';
import { sanctions } from '../schema/sanctions';
import { seasons } from '../schema/ratings';
import { templates } from '../schema/templates';
import { settings } from '../schema/settings';
import { certifications } from '../schema/certifications';
import { scopeTransaction } from '../tenant-scope';
import { readDatabaseTime } from '../database-clock';
import { lockTabCommandAccounts } from './command-accounts';
import { loadAuthorityContext } from './authority-context';
import { lockEventSettingContext } from './event-setting-context';
import { loadLobbyAuthority } from './lobby-authority';
import { appendHistory, storedCommand } from './command-record';
import type { TabDatabase, TabTransaction } from './tab-transaction';

type Input = {
  readonly senderUserId: string;
  readonly organizationId: string;
  readonly lobbyId: string;
  readonly command: SanctionCommand;
};
async function load(tx: TabTransaction, input: Input) {
  const scope = {
    subjectUserId: input.senderUserId,
    organizationId: input.organizationId,
  };
  await scopeTransaction(tx, scope);
  await lockTabCommandAccounts(tx, [input.senderUserId]);
  const organization = await loadAuthorityContext(
    tx,
    scope,
    input.senderUserId,
    'share',
  );
  if (organization.organization?.organizationKind !== 'league') return null;
  const [sanction] = await tx
    .select()
    .from(sanctions)
    .where(
      and(
        eq(sanctions.organizationId, input.organizationId),
        input.command.type === 'request-sanction'
          ? eq(sanctions.eventId, input.command.eventId)
          : eq(sanctions.id, input.command.sanctionId),
      ),
    )
    .for('update');
  if (
    input.command.type !== 'request-sanction' &&
    (!sanction || sanction.lobbyId !== input.lobbyId)
  )
    return null;
  const eventId =
    input.command.type === 'request-sanction'
      ? input.command.eventId
      : sanction!.eventId;
  const templateId =
    input.command.type === 'request-sanction'
      ? input.command.templateId
      : sanction!.templateId;
  const seasonId =
    input.command.type === 'request-sanction'
      ? input.command.seasonId
      : sanction!.seasonId;
  const [template] = await tx
    .select()
    .from(templates)
    .where(
      and(
        eq(templates.id, templateId),
        eq(templates.organizationId, input.organizationId),
      ),
    )
    .for('share');
  const [season] = await tx
    .select()
    .from(seasons)
    .where(
      and(
        eq(seasons.id, seasonId),
        eq(seasons.organizationId, input.organizationId),
      ),
    )
    .for('share');
  if (!template || !season) return null;
  const templateSettings = await tx
    .select()
    .from(settings)
    .where(
      or(
        eq(settings.templateId, template.id),
        and(
          eq(settings.scopeKind, 'organization'),
          eq(settings.organizationId, input.organizationId),
        ),
      ),
    );
  const configuration = await lockEventSettingContext(tx, {
    lobbyId: input.lobbyId,
    eventId,
    subjectUserId: input.senderUserId,
    extraOrganizationIds: [input.organizationId],
  });
  if (!configuration) return null;
  const lobby = await loadLobbyAuthority(tx, {
    viewerUserId: input.senderUserId,
    lobbyId: input.lobbyId,
  });
  if (!lobby) return null;
  const eventCertified =
    (
      await tx
        .select({ id: certifications.id })
        .from(certifications)
        .where(eq(certifications.eventId, eventId))
        .limit(1)
    ).length > 0;
  await scopeTransaction(tx, { ...scope, lobbyId: input.lobbyId });
  return {
    organization,
    lobby,
    configuration,
    sanction: sanction ?? null,
    template,
    season,
    templateSettings,
    eventCertified,
    now: (await readDatabaseTime(tx)).toISOString(),
  };
}
export type SanctionCommandFacts = NonNullable<
  Awaited<ReturnType<typeof load>>
>;
export type SanctionStoreWrite =
  | {
      readonly table: 'sanctions';
      readonly op: 'insert';
      readonly row: Omit<typeof sanctions.$inferInsert, 'decidedAt'>;
    }
  | {
      readonly table: 'sanctions';
      readonly op: 'update';
      readonly id: string;
      readonly set: {
        readonly status: typeof sanctions.$inferInsert.status;
        readonly decidedAt?: string;
        readonly updatedAt: string;
        readonly version: number;
      };
    };
export const createSanctionCommandStore = (database: TabDatabase) => ({
  sanctionCommand: <Answer>(
    input: Input,
    work: (session: {
      readonly load: () => Promise<SanctionCommandFacts | null>;
      readonly stored: (id: string) => ReturnType<typeof storedCommand>;
      readonly apply: (
        writes: readonly SanctionStoreWrite[],
        history: ActionHistoryEntry,
        receipt: LobbyCommandReceipt,
      ) => Promise<void>;
    }) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) =>
      work({
        load: () => load(tx, input),
        stored: (id) => storedCommand(tx, id),
        apply: async (writes, history, receipt) => {
          await appendHistory(tx, history, receipt);
          for (const write of writes) {
            if (write.op === 'insert')
              await tx.insert(sanctions).values(write.row);
            else
              await tx
                .update(sanctions)
                .set({
                  status: write.set.status,
                  version: write.set.version,
                  updatedAt: new Date(write.set.updatedAt),
                  ...(write.set.decidedAt
                    ? { decidedAt: new Date(write.set.decidedAt) }
                    : {}),
                })
                .where(
                  and(
                    eq(sanctions.id, write.id),
                    eq(sanctions.organizationId, input.organizationId),
                  ),
                );
          }
        },
      }),
    ),
});
