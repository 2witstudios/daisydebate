import { resolveSettings, roomChain } from '@daisy/protocol/setting-resolution';
import {
  formatDefinitionSchema,
  roomConfigSchema,
  type RoomConfig,
} from '@daisy/protocol';
import type { StandingRoomDraftFacts } from '@daisy/db/tab';
import { presetSettingDefaults } from './format-setting-defaults';
import { settingRow } from './setting-facts';

/** The actual offered pin and resolved chain used by both form reads and creation. */
export function standingRoomSettings(
  facts: StandingRoomDraftFacts,
  templateId: string | null,
  fallback?: RoomConfig,
) {
  const template = facts.graph.templates.find(
    (row) =>
      row.id === templateId &&
      row.retiredAt === null &&
      facts.offered.some((offer) => offer.templateId === row.id),
  );
  const preset = template
    ? facts.graph.presets
        .filter(
          (row) =>
            row.formatId === template.formatId &&
            row.formatVersion === template.formatVersion &&
            row.supersededAt === null,
        )
        .sort((a, b) => b.version - a.version)[0]
    : undefined;
  const definition = template
    ? facts.definitions.find(
        (row) =>
          row.formatId === template.formatId &&
          row.version === template.formatVersion,
      )
    : undefined;
  const config = preset?.config ?? fallback;
  if (!config || !facts.lobby.ownerOrganizationId) return null;
  const chain = roomChain({
    organizationId: facts.lobby.ownerOrganizationId,
    templateId: template?.id ?? null,
    lobbyId: facts.lobby.id,
  });
  const settings = resolveSettings(
    chain,
    facts.graph.settings.map(settingRow),
    presetSettingDefaults(config),
  );
  return {
    template: template ?? null,
    preset: preset ?? null,
    definition: definition
      ? formatDefinitionSchema.parse(definition.definition)
      : null,
    settings,
  };
}

/** Room's canonical config vocabulary; compile against the selected definition afterwards. */
export function standingRoomConfig(
  config: RoomConfig,
  resolved: NonNullable<ReturnType<typeof standingRoomSettings>>,
  choices: readonly { readonly text: string }[],
): RoomConfig {
  const timing = resolved.settings['room.timing'].value;
  const floor = resolved.settings['room.floor'].value;
  const rule = resolved.settings['resolution.rule'].value;
  const unique = [...new Set(choices.map((row) => row.text))].slice(0, 20);
  return roomConfigSchema.parse({
    ...config,
    preRoundPrep: timing.preRoundPrepMs
      ? { enabled: true, durationMs: timing.preRoundPrepMs }
      : { enabled: false },
    inRoundPrep: timing.inRoundPrepMsPerSide
      ? { enabled: true, budgetMsPerSide: timing.inRoundPrepMsPerSide }
      : { enabled: false },
    speechTiming: { ...config.speechTiming, countdownMs: timing.countdownMs },
    interruptions: floor.interruptions,
    yielding: floor.yielding,
    resolutionDraw:
      rule.method === 'strike' && unique.length >= rule.drawSize
        ? {
            enabled: true,
            drawSize: rule.drawSize,
            strikeWindowMs: rule.strikeWindowMs,
            firstStriker:
              resolved.definition?.sides[rule.firstStriker]?.key ??
              'affirmative',
            source: { kind: 'host', resolutions: unique },
          }
        : rule.method === 'strike'
          ? config.resolutionDraw
          : { enabled: false },
  });
}
