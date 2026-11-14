import type { SettingKey } from '@daisy/protocol/setting-values';
import { and, eq, isNull } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { SettingHold, SettingScope } from '@daisy/protocol/settings';
import { jsonObjectSchema } from '../schema/columns';
import { settings } from '../schema/settings';
import { organizations } from '../schema/organizations';
import { templates, lobbyTemplates } from '../schema/templates';
import { lobbies } from '../schema/lobbies';
import { events } from '../schema/events';
import type { TabTransaction } from './tab-transaction';

type ScopeColumns = {
  readonly scopeKind: SettingScope['kind'];
  readonly organizationId: string | null;
  readonly templateId: string | null;
  readonly lobbyId: string | null;
  readonly eventId: string | null;
};
type Pins = {
  readonly formatId: string;
  readonly formatVersion: number;
  readonly ballotDefinitionId: string | null;
  readonly ballotDefinitionVersion: number | null;
};
export type SettingWrite =
  | {
      readonly table: 'settings';
      readonly op: 'insert';
      readonly row: ScopeColumns & {
        readonly key: SettingKey;
        readonly hold: SettingHold;
        readonly value: unknown;
      };
    }
  | {
      readonly table: 'settings';
      readonly op: 'update';
      readonly where: ScopeColumns & { readonly key: SettingKey };
      readonly set: { readonly hold: SettingHold; readonly value: unknown };
    }
  | {
      readonly table: 'settings';
      readonly op: 'delete';
      readonly where: ScopeColumns & { readonly key: SettingKey };
    }
  | {
      readonly table: 'organizations' | 'templates' | 'lobbies' | 'events';
      readonly op: 'update';
      readonly id: string;
      readonly set: { readonly settingsVersion: number };
    }
  | {
      readonly table: 'templates';
      readonly op: 'insert';
      readonly row: Pins & {
        readonly id: string;
        readonly organizationId: string;
        readonly name: string;
      };
    }
  | {
      readonly table: 'templates';
      readonly op: 'update';
      readonly id: string;
      readonly set: {
        readonly name?: string;
        readonly retiredAt?: string;
        readonly version: number;
      };
    }
  | {
      readonly table: 'lobby_templates';
      readonly op: 'insert';
      readonly row: { readonly lobbyId: string; readonly templateId: string };
    }
  | {
      readonly table: 'lobby_templates';
      readonly op: 'update';
      readonly key: { readonly lobbyId: string; readonly templateId: string };
      readonly set: { readonly withdrawnAt: string | null };
    }
  | {
      readonly table: 'lobbies';
      readonly op: 'update';
      readonly id: string;
      readonly set: { readonly version: number };
    }
  | {
      readonly table: 'events';
      readonly op: 'update';
      readonly id: string;
      readonly set: Partial<Pins> & {
        readonly templateId?: string | null;
        readonly version: number;
        readonly settingsVersion: number;
      };
    };

const one = (rows: readonly unknown[]): void => {
  if (rows.length !== 1)
    throw createAppError('INVARIANT', 'Setting write did not affect one row');
};
const matches = (where: ScopeColumns & { readonly key: SettingKey }) =>
  and(
    eq(settings.scopeKind, where.scopeKind),
    eq(settings.key, where.key),
    where.organizationId === null
      ? isNull(settings.organizationId)
      : eq(settings.organizationId, where.organizationId),
    where.templateId === null
      ? isNull(settings.templateId)
      : eq(settings.templateId, where.templateId),
    where.lobbyId === null
      ? isNull(settings.lobbyId)
      : eq(settings.lobbyId, where.lobbyId),
    where.eventId === null
      ? isNull(settings.eventId)
      : eq(settings.eventId, where.eventId),
  );
const applySetting = async (
  tx: TabTransaction,
  write: Extract<SettingWrite, { table: 'settings' }>,
  newId: () => string,
) => {
  if (write.op === 'insert') {
    await tx.insert(settings).values({
      ...write.row,
      id: newId(),
      value: jsonObjectSchema.parse(write.row.value),
    });
    return;
  }
  if (write.op === 'delete')
    return one(
      await tx
        .delete(settings)
        .where(matches(write.where))
        .returning({ id: settings.id }),
    );
  return one(
    await tx
      .update(settings)
      .set({
        hold: write.set.hold,
        value: jsonObjectSchema.parse(write.set.value),
      })
      .where(matches(write.where))
      .returning({ id: settings.id }),
  );
};
const apply = async (
  tx: TabTransaction,
  write: SettingWrite,
  newId: () => string,
): Promise<void> => {
  switch (write.table) {
    case 'settings':
      return applySetting(tx, write, newId);
    case 'organizations':
      return one(
        await tx
          .update(organizations)
          .set(write.set)
          .where(eq(organizations.id, write.id))
          .returning({ id: organizations.id }),
      );
    case 'templates':
      if (write.op === 'insert') {
        await tx.insert(templates).values(write.row);
        return;
      }
      return one(
        await tx
          .update(templates)
          .set(
            'settingsVersion' in write.set
              ? write.set
              : {
                  name: write.set.name,
                  version: write.set.version,
                  retiredAt:
                    write.set.retiredAt === undefined
                      ? undefined
                      : new Date(write.set.retiredAt),
                },
          )
          .where(eq(templates.id, write.id))
          .returning({ id: templates.id }),
      );
    case 'lobby_templates':
      if (write.op === 'insert') {
        await tx.insert(lobbyTemplates).values(write.row);
        return;
      }
      return one(
        await tx
          .update(lobbyTemplates)
          .set({
            withdrawnAt:
              write.set.withdrawnAt === null
                ? null
                : new Date(write.set.withdrawnAt),
          })
          .where(
            and(
              eq(lobbyTemplates.lobbyId, write.key.lobbyId),
              eq(lobbyTemplates.templateId, write.key.templateId),
            ),
          )
          .returning({ id: lobbyTemplates.templateId }),
      );
    case 'lobbies':
      return one(
        await tx
          .update(lobbies)
          .set(write.set)
          .where(eq(lobbies.id, write.id))
          .returning({ id: lobbies.id }),
      );
    case 'events':
      return one(
        await tx
          .update(events)
          .set(write.set)
          .where(eq(events.id, write.id))
          .returning({ id: events.id }),
      );
  }
};
export const applySettingWrites = async (
  tx: TabTransaction,
  writes: readonly SettingWrite[],
  newId: () => string,
): Promise<void> => {
  for (const write of writes) await apply(tx, write, newId);
};
