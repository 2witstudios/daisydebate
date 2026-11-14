import { z } from 'zod';
import { idSchema } from '../primitives';
import {
  settingHoldSchema,
  settingScopeKindSchema,
  settingsCatalogue,
  type SettingDefinition,
} from '../settings/catalogue';
import { settingKeys, type SettingKey } from '../settings/keys';
import {
  pairingPresetNames,
  settingKeySchema,
} from '../settings/setting-values';
import type { LobbyReadCatalogue } from './read';

/**
 * What a resolved-settings view is asked at: a setting scope, or a Room
 * being drafted in a standing lobby, which reads the lobby's chain through
 * the template it would follow (null when it follows none).
 */
export const settingsAtSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('organization'), id: idSchema }),
  z.strictObject({ kind: z.literal('template'), id: idSchema }),
  z.strictObject({ kind: z.literal('lobby'), id: idSchema }),
  z.strictObject({ kind: z.literal('event'), id: idSchema }),
  z.strictObject({
    kind: z.literal('room_draft'),
    lobbyId: idSchema,
    templateId: idSchema.nullable(),
  }),
]);
export type SettingsAt = z.infer<typeof settingsAtSchema>;

type FamilyOf<Key extends string> = Key extends `${infer Family}.${string}`
  ? Family
  : never;
export type SettingKeyFamily = FamilyOf<SettingKey>;
/** A key's family is the part of its name before the dot: `audience`, `pairing`. */
export const settingKeyFamilyOf = (key: SettingKey): SettingKeyFamily =>
  key.slice(0, key.indexOf('.')) as SettingKeyFamily;
export const settingKeyFamilies = [
  ...new Set(settingKeys.map(settingKeyFamilyOf)),
] as [SettingKeyFamily, ...SettingKeyFamily[]];
export const settingKeyFamilySchema = z.enum(settingKeyFamilies);

/** The query: where, and optionally one family of keys. */
export const resolvedSettingsQuerySchema = z.strictObject({
  at: settingsAtSchema,
  family: settingKeyFamilySchema.optional(),
});
export type ResolvedSettingsQuery = z.infer<typeof resolvedSettingsQuerySchema>;

/**
 * Why the caller may not set a key where they asked: a scope above enforces
 * it, the key is not set at this kind of scope, or they lack the permission.
 * Null when they may.
 */
export const settingLocks = ['enforced', 'scope', 'not-permitted'] as const;
export const settingLockSchema = z.enum(settingLocks);
export type SettingLock = z.infer<typeof settingLockSchema>;

/**
 * Where a resolved value came from: Daisy's catalogue default, the resolved
 * pairing preset, the pinned format, or a row at a scope, named.
 */
export const resolvedSettingSourceSchema = z.union([
  z.strictObject({ kind: z.literal('catalogue') }),
  z.strictObject({
    kind: z.literal('preset'),
    preset: z.enum(pairingPresetNames),
  }),
  z.strictObject({ kind: z.literal('format') }),
  z.strictObject({
    kind: settingScopeKindSchema,
    id: idSchema,
    name: z.string().trim().min(1).max(200),
  }),
]);
export type ResolvedSettingSource = z.infer<typeof resolvedSettingSourceSchema>;

const fitsKey = (
  key: SettingKey,
  value: unknown,
  path: readonly (string | number)[],
  context: z.RefinementCtx,
) => {
  const definition: SettingDefinition = settingsCatalogue[key];
  const parsed = definition.value.safeParse(value);
  for (const issue of parsed.success ? [] : parsed.error.issues)
    context.addIssue({
      code: 'custom',
      message: issue.message,
      path: [...path, ...issue.path],
    });
};

/** The row the scope asked about holds for a key. */
export const ownSettingRowSchema = z.strictObject({
  value: z.unknown(),
  hold: settingHoldSchema,
});

/**
 * One key as the scope asked about resolves it: the value, where it came
 * from and its hold; the row at that scope, if any; and whether the caller
 * may set it there. A default from the catalogue, a preset or the format is
 * never enforced.
 */
export const resolvedSettingEntrySchema = z
  .strictObject({
    key: settingKeySchema,
    value: z.unknown(),
    source: resolvedSettingSourceSchema,
    hold: settingHoldSchema,
    own: ownSettingRowSchema.nullable(),
    locked: settingLockSchema.nullable(),
  })
  .superRefine((entry, context) => {
    fitsKey(entry.key, entry.value, ['value'], context);
    if (entry.own)
      fitsKey(entry.key, entry.own.value, ['own', 'value'], context);
    const fromRow = 'id' in entry.source;
    if (!fromRow && entry.hold === 'enforced')
      context.addIssue({
        code: 'custom',
        message: 'Only a row can enforce a value.',
        path: ['hold'],
      });
  });
export type ResolvedSettingEntry = z.infer<typeof resolvedSettingEntrySchema>;

/** Every key (or every key of one family) as the scope asked about resolves it. */
export const resolvedSettingsViewSchema = z
  .strictObject({
    at: settingsAtSchema,
    settings: z.array(resolvedSettingEntrySchema),
  })
  .refine(
    (view) =>
      new Set(view.settings.map((entry) => entry.key)).size ===
      view.settings.length,
    { message: 'A key is resolved once.', path: ['settings'] },
  )
  .refine(
    (view) =>
      view.at.kind !== 'room_draft' ||
      view.settings.every((entry) => entry.own === null),
    {
      message: 'A Room being drafted holds no rows of its own.',
      path: ['settings'],
    },
  );
export type ResolvedSettingsView = z.infer<typeof resolvedSettingsViewSchema>;

/** The read capability of what is asked about. */
export const resolvedSettingsGateOf = (
  at: SettingsAt,
): 'organization.read' | 'template.read' | 'lobby.read' => {
  switch (at.kind) {
    case 'organization':
      return 'organization.read';
    case 'template':
      return 'template.read';
    case 'lobby':
    case 'event':
    case 'room_draft':
      return 'lobby.read';
  }
};

export const resolvedSettingsReadCatalogue = {
  ResolvedSettingsView: {
    gate: ['organization.read', 'template.read', 'lobby.read'],
  },
} as const satisfies LobbyReadCatalogue<'ResolvedSettingsView'>;
