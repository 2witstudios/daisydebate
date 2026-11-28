import type { CreateRoomReads } from './league';
import type { StandingRoomCreation } from './standing-room-creation';
import type { SettingLine } from './settings';
import { settingLineOf, lockedSetting } from './settings';
import { settingValueSchemas } from '@daisy/protocol/setting-values';
import { resolvedEntry } from './reads/resolved-settings';
export type StandingRoomView = {
  readonly leagueHandle: string;
  readonly lobby: CreateRoomReads['lobby'];
  readonly templateId: string;
  readonly templates: readonly {
    readonly id: string;
    readonly name: string;
    readonly detail: string;
  }[];
  readonly locked: readonly SettingLine[];
  readonly defaults: readonly SettingLine[];
  readonly creation: StandingRoomCreation;
};
/** Labels and values come from the selected resolved read, never from preview fixtures. */
export function standingRoomView(
  read: CreateRoomReads,
  creation: StandingRoomCreation,
  leagueHandle: string,
): StandingRoomView | null {
  if (read.draft.at.kind !== 'room_draft' || !read.draft.at.templateId)
    return null;
  const templateId = read.draft.at.templateId;
  const template = read.templates.find((row) => row.templateId === templateId);
  if (!template) return null;
  const source = { scope: 'template' as const, name: template.name };
  const pins: SettingLine[] = [
    {
      keys: ['format'],
      label: 'Format',
      value: `${template.format.name} · version ${template.format.formatVersion}`,
      source,
      control: lockedSetting,
      attention: null,
    },
    {
      keys: ['ballot.definition'],
      label: 'Ballot',
      value: template.ballotDefinition?.name ?? 'Daisy ballot',
      source,
      control: lockedSetting,
      attention: null,
    },
  ];
  const lines: SettingLine[] = [];
  const timing = resolvedEntry(read.draft, 'room.timing');
  if (timing) {
    const value = settingValueSchemas['room.timing'].parse(timing.value);
    lines.push(
      settingLineOf(timing, {
        keys: ['room.timing'],
        label: 'Timing',
        value: `${value.preRoundPrepMs / 60000} minutes preparation · ${value.inRoundPrepMsPerSide / 60000} minutes in-round preparation · ${value.countdownMs / 1000} seconds countdown`,
      }),
    );
  }
  const floor = resolvedEntry(read.draft, 'room.floor');
  if (floor) {
    const value = settingValueSchemas['room.floor'].parse(floor.value);
    lines.push(
      settingLineOf(floor, {
        keys: ['room.floor'],
        label: 'Floor',
        value: [
          value.yielding?.allowed ? 'Yielding allowed' : 'No yielding',
          value.pointsOfInformation?.enabled
            ? 'Points of information'
            : 'No points of information',
        ].join(' · '),
      }),
    );
  }
  return {
    leagueHandle,
    lobby: read.lobby,
    templateId: template.templateId,
    templates: read.templates.map((row) => ({
      id: row.templateId,
      name: row.name,
      detail: row.format.name,
    })),
    locked: [
      ...pins,
      ...lines.filter((line) => line.control.kind === 'locked'),
    ],
    defaults: lines.filter((line) => line.control.kind !== 'locked'),
    creation,
  };
}
export function standingRoomUnavailableReason(
  creation: StandingRoomCreation,
): string | null {
  if (creation.rating.kind === 'unsupported')
    return 'This format is unavailable on the league ladder.';
  const policy = creation.resolutionChoicePolicy;
  if (policy.method === 'fixed')
    return policy.choices.length === 0 && !policy.ownText
      ? 'No resolutions are available.'
      : null;
  if (policy.method === 'draw')
    return policy.choices.length === 0 ? 'No resolutions are available.' : null;
  if (!creation.config.resolutionDraw.enabled)
    return 'There are not enough resolutions in the pool.';
  const required = Math.max(2, creation.config.resolutionDraw.drawSize);
  return policy.choices.length < required
    ? 'There are not enough resolutions in the pool.'
    : null;
}
