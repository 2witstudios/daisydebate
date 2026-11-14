import {
  resolvedSettingsViewSchema,
  type ResolvedSettingsView,
} from '@daisy/protocol/lobby/resolved-settings-read';
import {
  eventChain,
  resolveSetting,
  roomChain,
} from '@daisy/protocol/setting-resolution';
import type { SettingRow, SettingScope } from '@daisy/protocol/settings';
import type { SettingKey } from '@daisy/protocol/setting-values';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  resolvedEntry,
  resolvedSettingsViewOf,
  type ResolvedSettingsFacts,
} from './resolved-settings';

setupRitewayBun();

const id = (name: string) => name.padEnd(24, '0');
const league: SettingScope = { kind: 'organization', id: id('league') };
const template: SettingScope = { kind: 'template', id: id('template') };
const lobby: SettingScope = { kind: 'lobby', id: id('lobby') };
const event: SettingScope = { kind: 'event', id: id('event') };
const names: Record<string, string> = {
  [league.id]: 'Southeast League',
  [template.id]: 'Varsity',
  [lobby.id]: 'Autumn Open',
  [event.id]: 'Varsity debate',
};
const format: ResolvedSettingsFacts['format'] = {
  'room.timing': { preRoundPrepMs: 0, inRoundPrepMsPerSide: 0, countdownMs: 0 },
  'room.floor': {
    interruptions: { mode: 'disabled', minRemainingMs: 0 },
    yielding: { allowed: false, returnsTime: false },
  },
};
const rows: readonly SettingRow[] = [
  {
    scope: league,
    key: 'recording.capture',
    value: { value: 'on' },
    hold: 'enforced',
  },
  {
    scope: template,
    key: 'pairing.preset',
    value: { value: 'random' },
    hold: 'default',
  },
  {
    scope: lobby,
    key: 'conflict.handling',
    value: { value: 'flagged' },
    hold: 'default',
  },
  {
    scope: lobby,
    key: 'room.visibility',
    value: { value: 'unlisted' },
    hold: 'enforced',
  },
];
const facts = (
  at: ResolvedSettingsFacts['at'],
  chain: ResolvedSettingsFacts['chain'],
  reads: ResolvedSettingsFacts['reads'],
  family?: ResolvedSettingsFacts['family'],
): ResolvedSettingsFacts => ({
  at,
  chain,
  rows,
  format,
  scopeName: (scope) => names[scope.id] ?? scope.id,
  reads,
  ...(family === undefined ? {} : { family }),
});
const pick = (view: ResolvedSettingsView, key: SettingKey) => {
  const entry = resolvedEntry(view, key);
  return (
    entry && { source: entry.source, own: entry.own, locked: entry.locked }
  );
};

const eventFacts = facts(
  { kind: 'event', id: event.id },
  eventChain({
    template: { id: template.id, organizationId: league.id },
    leagueId: league.id,
    lobbyId: lobby.id,
    eventId: event.id,
  }),
  'event',
);
const draftFacts = facts(
  { kind: 'room_draft', lobbyId: lobby.id, templateId: template.id },
  roomChain({
    organizationId: league.id,
    templateId: template.id,
    lobbyId: lobby.id,
  }),
  'room',
);

describe('resolvedSettingsViewOf', async () => {
  test('a view built at every kind of place', () => {
    const views = [
      resolvedSettingsViewOf(
        facts({ kind: 'organization', id: league.id }, [league], 'every'),
        true,
      ),
      resolvedSettingsViewOf(
        facts(
          { kind: 'template', id: template.id },
          [league, template],
          'every',
        ),
        true,
      ),
      resolvedSettingsViewOf(
        facts({ kind: 'lobby', id: lobby.id }, [league, lobby], 'room'),
        true,
      ),
      resolvedSettingsViewOf(eventFacts, true),
      resolvedSettingsViewOf(draftFacts, true),
    ];
    assert({
      given:
        'an organization, a template, a lobby, an event and a Room being drafted',
      should: 'parse as the protocol contract',
      actual: views.map(
        (view) => resolvedSettingsViewSchema.safeParse(view).success,
      ),
      expected: [true, true, true, true, true],
    });
  });

  test('values come from the one resolver', () => {
    const view = resolvedSettingsViewOf(eventFacts, true);
    assert({
      given: 'every key an event reads',
      should: 'carry the value and hold the resolver gives',
      actual: view.settings.every((entry) => {
        const resolved = resolveSetting(
          entry.key,
          eventFacts.chain,
          rows,
          format,
        );
        return (
          JSON.stringify(resolved.value) === JSON.stringify(entry.value) &&
          resolved.hold === entry.hold
        );
      }),
      expected: true,
    });
  });

  test('sources', () => {
    const view = resolvedSettingsViewOf(eventFacts, true);
    assert({
      given: 'a row, a catalogue default and a preset default',
      should: 'name the scope with its name, the catalogue, or the preset',
      actual: [
        resolvedEntry(view, 'pairing.preset')?.source,
        resolvedEntry(view, 'ballot.screening')?.source,
        resolvedEntry(view, 'pairing.rematch')?.source,
        resolvedEntry(view, 'room.timing')?.source,
      ],
      expected: [
        { kind: 'template', id: template.id, name: 'Varsity' },
        { kind: 'catalogue' },
        { kind: 'preset', preset: 'random' },
        { kind: 'format' },
      ],
    });
  });

  test('locks at a scope', () => {
    const atTemplate = facts(
      { kind: 'template', id: template.id },
      [league, template],
      'every',
    );
    const atLobby = facts(
      { kind: 'lobby', id: lobby.id },
      [league, lobby],
      'room',
    );
    assert({
      given:
        'a key enforced above, a key not set at events, a key the caller holds',
      should: 'answer enforced, scope, and null with its own row',
      actual: [
        pick(resolvedSettingsViewOf(eventFacts, true), 'recording.capture')
          ?.locked,
        pick(resolvedSettingsViewOf(eventFacts, true), 'conflict.handling')
          ?.locked,
        pick(resolvedSettingsViewOf(atTemplate, true), 'pairing.preset'),
        pick(resolvedSettingsViewOf(atLobby, true), 'room.visibility'),
      ],
      expected: [
        'enforced',
        'scope',
        {
          source: { kind: 'template', id: template.id, name: 'Varsity' },
          own: { value: { value: 'random' }, hold: 'default' },
          locked: null,
        },
        {
          source: { kind: 'lobby', id: lobby.id, name: 'Autumn Open' },
          own: { value: { value: 'unlisted' }, hold: 'enforced' },
          locked: null,
        },
      ],
    });
    assert({
      given: 'a caller the setting command does not allow at the scope',
      should: 'lock what is not otherwise locked as not permitted',
      actual: [
        pick(resolvedSettingsViewOf(atTemplate, false), 'pairing.preset')
          ?.locked,
        pick(resolvedSettingsViewOf(atTemplate, false), 'recording.capture')
          ?.locked,
        pick(resolvedSettingsViewOf(atTemplate, true), 'entry.registration')
          ?.locked,
      ],
      expected: ['not-permitted', 'enforced', 'scope'],
    });
  });

  test('a Room being drafted', () => {
    const view = resolvedSettingsViewOf(draftFacts, true);
    assert({
      given: 'the draft of a Room in a standing lobby',
      should:
        'carry only keys a Room reads, no own rows, enforced values locked',
      actual: {
        keysRoomsNeverRead: view.settings.filter((entry) =>
          ['recording.capture', 'pairing.preset', 'judging.panel'].includes(
            entry.key,
          ),
        ).length,
        ownRows: view.settings.filter((entry) => entry.own !== null).length,
        visibility: pick(view, 'room.visibility')?.locked,
        posting: pick(view, 'audience.posting')?.locked,
      },
      expected: {
        keysRoomsNeverRead: 0,
        ownRows: 0,
        visibility: 'enforced',
        posting: null,
      },
    });
  });

  test('one family', () => {
    const view = resolvedSettingsViewOf(
      facts(
        { kind: 'organization', id: league.id },
        [league],
        'every',
        'audience',
      ),
      true,
    );
    assert({
      given: 'a query for the audience family',
      should: 'carry exactly the audience keys',
      actual: view.settings.map((entry) => entry.key),
      expected: [
        'audience.posting',
        'audience.decision',
        'audience.scores',
        'audience.reason',
        'audience.feedback',
        'audience.video',
      ],
    });
  });
});
