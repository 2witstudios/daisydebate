import { z } from 'zod';
import { idSchema } from '../primitives';
import {
  settingHoldSchema,
  settingRowSchema,
  settingScopeKindSchema,
} from '../settings/catalogue';
import { settingKeySchema } from '../settings/setting-values';
import {
  lobbyCommandEnvelope,
  type LobbyCommandCatalogue,
  type LobbyCommandDefinition,
} from './command';

/**
 * The setting and template commands (TAB-5.19). One `set-setting` and one
 * `clear-setting` serve every catalogue key: the value parses under the
 * key's own schema, at a scope the key allows, with a hold it allows, or the
 * payload is invalid. A template's format and ballot definition are pinned
 * when it is made and no command changes them; retiring a template stops
 * new follows, offers and copies only.
 */

const settingScope = z.strictObject({
  kind: settingScopeKindSchema,
  id: idSchema,
});

const setSetting = z
  .strictObject({
    type: z.literal('set-setting'),
    scope: settingScope,
    key: settingKeySchema,
    value: z.unknown(),
    hold: settingHoldSchema,
  })
  .superRefine((command, context) => {
    const parsed = settingRowSchema.safeParse({
      scope: command.scope,
      key: command.key,
      value: command.value,
      hold: command.hold,
    });
    for (const issue of parsed.success ? [] : parsed.error.issues)
      context.addIssue({
        code: 'custom',
        message: issue.message,
        path: issue.path,
      });
  })
  .transform((command) => ({
    ...command,
    // The value as its key's schema reads it, so equal values compare equal.
    value: settingRowSchema.parse({
      scope: command.scope,
      key: command.key,
      value: command.value,
      hold: command.hold,
    }).value,
  }));

const templateName = z.string().trim().min(1).max(120);
/** A pinned revision: an id and its version. */
const pin = z.strictObject({ id: idSchema, version: z.int().positive() });
const onTemplate = { templateId: idSchema } as const;

export const settingCommandSchema = z.discriminatedUnion('type', [
  setSetting,
  z.strictObject({
    type: z.literal('clear-setting'),
    scope: settingScope,
    key: settingKeySchema,
  }),
  z.strictObject({
    type: z.literal('create-template'),
    organizationId: idSchema,
    name: templateName,
    format: pin,
    /** Null is the Daisy ballot. */
    ballotDefinition: pin.nullable(),
  }),
  /** The name only: the pins never change, and a different pin is a new template. */
  z.strictObject({
    type: z.literal('revise-template'),
    ...onTemplate,
    name: templateName,
  }),
  z.strictObject({ type: z.literal('retire-template'), ...onTemplate }),
  z.strictObject({
    type: z.literal('offer-template'),
    lobbyId: idSchema,
    ...onTemplate,
  }),
  z.strictObject({
    type: z.literal('withdraw-template'),
    lobbyId: idSchema,
    ...onTemplate,
  }),
  z.strictObject({
    type: z.literal('copy-template'),
    eventId: idSchema,
    ...onTemplate,
  }),
  z.strictObject({
    type: z.literal('follow-template'),
    eventId: idSchema,
    ...onTemplate,
  }),
  z.strictObject({
    type: z.literal('stop-following-template'),
    eventId: idSchema,
  }),
]);
export type SettingCommand = z.infer<typeof settingCommandSchema>;
export const settingCommandEnvelopeSchema =
  lobbyCommandEnvelope(settingCommandSchema);

/** Every refusal a setting or template command can give, beside the shared ones. */
export const settingRefusals = [
  'setting-enforced',
  'enforced-conflict',
  'format-forbids',
  'sanction-holds',
  'division-in-use',
  'breaks-share-slot',
  'setting-absent',
  'format-unavailable',
  'illegal-definition',
  'already-retired',
  'lobby-not-standing',
  'template-unavailable',
  'already-offered',
  'not-offered',
  'entries-exist',
  'already-following',
  'not-following',
] as const;
export type SettingRefusal = (typeof settingRefusals)[number];
export const settingRefusalSchema = z.enum(settingRefusals);

type Definition = LobbyCommandDefinition<SettingRefusal>;
const entry = (definition: Omit<Definition, 'history'>): Definition => ({
  history: 'entry',
  ...definition,
});
const onTemplateRow = (
  definition: Omit<Definition, 'history' | 'aggregate' | 'gate'>,
): Definition =>
  entry({
    aggregate: 'template',
    gate: ['organization.manage'],
    ...definition,
  });
const onEvent = (refusals: readonly SettingRefusal[]): Definition =>
  entry({
    aggregate: 'event',
    gate: ['lobby.setup.manage'],
    versions: ['event', 'entries', 'settings'],
    refusals,
  });
const onLobby = (refusals: readonly SettingRefusal[]): Definition =>
  entry({
    aggregate: 'lobby',
    gate: ['lobby.setup.manage'],
    versions: ['lobby'],
    refusals,
  });

/**
 * A setting command's catalogue entry names both gates and the widest
 * aggregate; `settingCommandDefinition` narrows them to the scope written.
 */
const setting = (refusals: readonly SettingRefusal[]): Definition =>
  entry({
    aggregate: 'organization',
    gate: ['organization.manage', 'lobby.setup.manage'],
    versions: ['settings'],
    refusals,
  });

export const settingCommandCatalogue = {
  'set-setting': setting([
    'setting-enforced',
    'enforced-conflict',
    'format-forbids',
    'sanction-holds',
    'division-in-use',
    'breaks-share-slot',
  ]),
  'clear-setting': setting([
    'setting-absent',
    'sanction-holds',
    'division-in-use',
    'breaks-share-slot',
  ]),
  'create-template': onTemplateRow({
    versions: [],
    refusals: ['format-unavailable', 'illegal-definition'],
  }),
  'revise-template': onTemplateRow({ versions: ['template'], refusals: [] }),
  'retire-template': onTemplateRow({
    versions: ['template'],
    refusals: ['already-retired'],
  }),
  'offer-template': onLobby([
    'lobby-not-standing',
    'template-unavailable',
    'already-offered',
    'enforced-conflict',
  ]),
  'withdraw-template': onLobby(['lobby-not-standing', 'not-offered']),
  'copy-template': onEvent(['entries-exist', 'template-unavailable']),
  'follow-template': onEvent([
    'entries-exist',
    'already-following',
    'template-unavailable',
    'enforced-conflict',
  ]),
  'stop-following-template': onEvent(['not-following', 'sanction-holds']),
} as const satisfies LobbyCommandCatalogue<SettingCommand>;

/**
 * The definition a command runs under. A setting command's gate is by scope:
 * `organization.manage` on the owning organization for an organization or a
 * template, `lobby.setup.manage` on the lobby for a lobby or an event; its
 * aggregate is the scope written. Every other command runs under its
 * catalogue entry.
 */
export function settingCommandDefinition(command: SettingCommand): Definition {
  const definition: Definition = settingCommandCatalogue[command.type];
  if (command.type !== 'set-setting' && command.type !== 'clear-setting')
    return definition;
  const kind = command.scope.kind;
  switch (kind) {
    case 'organization':
    case 'template':
      return { ...definition, aggregate: kind, gate: ['organization.manage'] };
    case 'lobby':
    case 'event':
      return { ...definition, aggregate: kind, gate: ['lobby.setup.manage'] };
  }
}
