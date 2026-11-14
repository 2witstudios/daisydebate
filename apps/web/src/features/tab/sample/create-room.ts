import type { TemplateView } from '@daisy/protocol/lobby/template-read';
import { roomChain } from '@daisy/protocol/setting-resolution';
import type { SettingScope } from '@daisy/protocol/settings';
import { choice } from '../action';
import type { CreateRoomCopy, CreateRoomReads } from '../league';
import { resolvedSettingsViewOf } from '../reads/resolved-settings';
import {
  leagueRows,
  sampleLeagueLobbySettings,
  sampleFormatDefaults,
  sampleScopeName,
  settingRow,
} from './league';
import { isMember } from './league-lobby';
import { LEAGUE, LEAGUE_NAME } from './moment';
import { sampleId, sampleIds } from './organization';
import type { SampleScene } from './scene';

const offered = (
  name: string,
  format: string,
  formatName: string,
): TemplateView => ({
  templateId: sampleId(`roomtemplate${name}`),
  name,
  organization: { organizationId: sampleIds.league, name: LEAGUE_NAME },
  format: { formatId: sampleId(format), formatVersion: 1, name: formatName },
  ballotDefinition: null,
  retiredAt: null,
  settings: [{ key: 'recording.capture', value: { value: 'on' }, hold: 'enforced' }],
  capabilities: { manage: false },
});

/** The templates the league's standing lobby offers, the first chosen. */
const templates = [
  offered('Varsity', 'formatoneonone', 'One-on-one'),
  offered('Novice', 'formatoneonone', 'One-on-one'),
  offered('Parli', 'formatparli', 'Two-on-two'),
] as const;

const copy: CreateRoomCopy = {
  name: 'Practice before Winter Classic',
  locked: [
    {
      keys: ['format'],
      label: 'Format',
      value: 'One-on-one, limited prep · 7 segments · 26 minutes',
    },
    {
      keys: ['ballot.definition'],
      label: 'Ballot',
      value: '20 to 30 in halves · no low-point wins',
    },
    {
      keys: ['resolution.rule'],
      label: 'Resolution',
      value: "You strike from five drawn from November's pool",
    },
    {
      keys: ['recording.capture', 'audience.video'],
      label: 'Recording',
      value: 'Recorded · video for the people in each round',
    },
  ],
  defaults: [
    choice('Who can join', ['League members', 'People I invite']),
    choice('Judge', ['A league member', 'No judge']),
  ],
  ladder: LEAGUE_NAME,
};

/** The reads the create-room form is drawn from, and its words. */
export function sampleCreateRoom(
  slug: string,
  scene: SampleScene,
): {
  readonly reads: CreateRoomReads;
  readonly copy: CreateRoomCopy;
} | null {
  // The draft is read under `lobby.read` and created under the member's
  // room creation: someone who is not a member is answered as missing.
  if (slug !== LEAGUE || !isMember(scene)) return null;
  const [chosen] = templates;
  const templateScope: SettingScope = { kind: 'template', id: chosen.templateId };
  const draft = resolvedSettingsViewOf(
    {
      at: {
        kind: 'room_draft',
        lobbyId: sampleIds.leagueLobby,
        templateId: chosen.templateId,
      },
      chain: roomChain({
        organizationId: sampleIds.league,
        templateId: chosen.templateId,
        lobbyId: sampleIds.leagueLobby,
      }),
      rows: [
        ...leagueRows,
        settingRow(templateScope, 'recording.capture', { value: 'on' }, 'enforced'),
      ],
      format: sampleFormatDefaults,
      scopeName: sampleScopeName,
      reads: 'room',
    },
    true,
  );
  return {
    reads: {
      lobby: { name: LEAGUE_NAME, handle: LEAGUE },
      draft,
      lobbySettings: sampleLeagueLobbySettings(),
      templates,
    },
    copy,
  };
}
