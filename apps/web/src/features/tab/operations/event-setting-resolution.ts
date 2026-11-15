import type { LoadedDrawCommand } from '@daisy/db/tab';
import {
  eventChain,
  resolveSettings,
} from '@daisy/protocol/setting-resolution';
import { presetSettingDefaults } from './format-setting-defaults';
import { settingRow } from './setting-facts';
/** Named resolved output of the actual fenced event chain, before each consumer selects its own keys. */
export const eventSettingResolution = (
  configuration: LoadedDrawCommand['configuration'],
) => {
  const { event, lobby, template } = configuration;
  const chain = eventChain({
    template,
    leagueId: lobby.ownerOrganizationId,
    lobbyId: lobby.id,
    eventId: event.id,
  });
  const rows = configuration.rows.map(settingRow);
  const format = presetSettingDefaults(configuration.preset.config);
  return {
    chain,
    rows,
    format,
    settings: resolveSettings(chain, rows, format),
  };
};
