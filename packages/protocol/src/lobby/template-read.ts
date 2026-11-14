import { z } from 'zod';
import { idSchema } from '../primitives';
import {
  settingHoldSchema,
  settingsCatalogue,
  type SettingDefinition,
} from '../settings/catalogue';
import { settingKeySchema } from '../settings/setting-values';
import type { LobbyReadCatalogue } from './read';

const name = z.string().trim().min(1).max(200);
const version = z.int().min(1);

/** One row a template holds itself, with its hold. */
export const templateSettingRowSchema = z
  .strictObject({
    key: settingKeySchema,
    value: z.unknown(),
    hold: settingHoldSchema,
  })
  .superRefine((row, context) => {
    const definition: SettingDefinition = settingsCatalogue[row.key];
    const parsed = definition.value.safeParse(row.value);
    for (const issue of parsed.success ? [] : parsed.error.issues)
      context.addIssue({
        code: 'custom',
        message: issue.message,
        path: ['value', ...issue.path],
      });
    if (!definition.scopes.includes('template'))
      context.addIssue({
        code: 'custom',
        message: 'The key is not set on a template.',
        path: ['key'],
      });
  });
export type TemplateSettingRow = z.infer<typeof templateSettingRowSchema>;

/**
 * A template: its name, the organization that owns it, the format and
 * ballot definition it pins (null is the Daisy ballot), whether it is
 * retired, and its own setting rows. `manage` is whether the viewer may set
 * its rows or retire it.
 */
export const templateViewSchema = z
  .strictObject({
    templateId: idSchema,
    name,
    organization: z.strictObject({ organizationId: idSchema, name }),
    format: z.strictObject({ formatId: idSchema, formatVersion: version, name }),
    ballotDefinition: z
      .strictObject({
        ballotDefinitionId: idSchema,
        ballotDefinitionVersion: version,
        name,
      })
      .nullable(),
    retiredAt: z.iso.datetime().nullable(),
    settings: z.array(templateSettingRowSchema),
    capabilities: z.strictObject({ manage: z.boolean() }),
  })
  .refine(
    (view) =>
      new Set(view.settings.map((row) => row.key)).size ===
      view.settings.length,
    { message: 'A template holds one row per key.', path: ['settings'] },
  );
export type TemplateView = z.infer<typeof templateViewSchema>;

export const templateReadCatalogue = {
  TemplateView: { gate: ['template.read'] },
} as const satisfies LobbyReadCatalogue<'TemplateView'>;
