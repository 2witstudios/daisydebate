import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { SettingCommand } from '@daisy/protocol/lobby/setting-command';
import {
  eventChain,
  type FormatSettingDefaults,
} from '@daisy/protocol/setting-resolution';
import type { SettingRow, SettingScope } from '@daisy/protocol/settings';
import type { SettingKey, SettingValues } from '@daisy/protocol/setting-values';
import {
  decideSetting,
  type EventFact,
  type ReachedChain,
  type SettingFacts,
  type TemplateRow,
} from './settings';

setupRitewayBun();

const now = '2026-11-14T12:00:00.000Z';
const league: SettingScope = { kind: 'organization', id: 'league' };
const template: SettingScope = { kind: 'template', id: 'tmpl' };
const cup: SettingScope = { kind: 'lobby', id: 'cup' };
const ld: SettingScope = { kind: 'event', id: 'ld' };

const format: FormatSettingDefaults = {
  'room.timing': {
    preRoundPrepMs: 0,
    inRoundPrepMsPerSide: 240_000,
    countdownMs: 5_000,
  },
  'room.floor': {
    interruptions: null,
    yielding: { allowed: false, returnsTime: false },
  },
};
const row = <Key extends SettingKey>(
  scope: SettingScope,
  key: Key,
  value: SettingValues[Key],
  hold: SettingRow['hold'] = 'default',
): SettingRow => ({ scope, key, value, hold }) as SettingRow;

const following = eventChain({
  template: { id: 'tmpl', organizationId: 'league' },
  leagueId: 'league',
  lobbyId: 'cup',
  eventId: 'ld',
});
const copied = eventChain({
  template: null,
  leagueId: 'league',
  lobbyId: 'cup',
  eventId: 'ld',
});
const holdings = { divisionsInUse: [], breaksShareSlot: false, sanction: null };
const reached = (overrides: Partial<ReachedChain> = {}): ReachedChain => ({
  chain: following,
  format,
  event: holdings,
  ...overrides,
});
const templateRow: TemplateRow = {
  id: 'tmpl',
  organizationId: 'league',
  name: 'Varsity LD',
  formatId: 'ld-format',
  formatVersion: 3,
  ballotDefinitionId: null,
  ballotDefinitionVersion: null,
  retiredAt: null,
  version: 2,
  format,
};
const event: EventFact = {
  ...holdings,
  id: 'ld',
  lobbyId: 'cup',
  leagueId: 'league',
  templateId: null,
  templateOrganizationId: null,
  version: 5,
  settingsVersion: 7,
  entryCount: 0,
  format,
};
const facts = (overrides: Partial<SettingFacts> = {}): SettingFacts => ({
  now,
  newId: 'new',
  rows: [],
  scope: { kind: 'lobby', id: 'cup', settingsVersion: 2 },
  reached: [reached()],
  ownFormat: null,
  template: templateRow,
  event,
  lobby: {
    id: 'cup',
    kind: 'standing',
    ownerOrganizationId: 'league',
    version: 4,
  },
  offer: null,
  nameTaken: false,
  formatRevision: { organizationId: null },
  ballotDefinition: null,
  ...overrides,
});
const refusalOf = (given: SettingFacts, command: SettingCommand) => {
  const decision = decideSetting(given, command);
  return decision.kind === 'refused' ? decision.refusal : 'accepted';
};
const writesOf = (given: SettingFacts, command: SettingCommand) => {
  const decision = decideSetting(given, command);
  return decision.kind === 'accepted' ? decision.writes : decision.refusal;
};
const set = <Key extends SettingKey>(
  scope: SettingScope,
  key: Key,
  value: SettingValues[Key],
  hold: SettingRow['hold'] = 'default',
): SettingCommand => ({ type: 'set-setting', scope, key, value, hold });
const cap = (perEvent: number) => ({ perEvent, perSchool: null });
const atLobby = {
  scopeKind: 'lobby',
  organizationId: null,
  templateId: null,
  lobbyId: 'cup',
  eventId: null,
} as const;
const atEvent = {
  scopeKind: 'event',
  organizationId: null,
  templateId: null,
  lobbyId: 'cup',
  eventId: 'ld',
} as const;
const floor = (interruptions: boolean): SettingValues['room.floor'] => ({
  interruptions: interruptions ? { mode: 'disabled', minRemainingMs: 0 } : null,
  yielding: { allowed: true, returnsTime: false },
});

describe('decideSetting: set and clear', () => {
  test('one set command writes one row at its scope', () => {
    assert({
      given: 'a new value, and a value replacing the scope’s row',
      should:
        'insert or update the one row and move the scope’s settings version',
      actual: [
        decideSetting(facts(), set(cup, 'entry.cap', cap(40))),
        writesOf(
          facts({ rows: [row(cup, 'entry.cap', cap(20))] }),
          set(cup, 'entry.cap', cap(40), 'enforced'),
        ),
      ],
      expected: [
        {
          kind: 'accepted',
          aggregate: { kind: 'lobby', id: 'cup' },
          resultingVersion: 3,
          writes: [
            {
              table: 'settings',
              op: 'insert',
              row: {
                ...atLobby,
                key: 'entry.cap',
                hold: 'default',
                value: cap(40),
              },
            },
            {
              table: 'lobbies',
              op: 'update',
              id: 'cup',
              set: { settingsVersion: 3 },
            },
          ],
          findings: [],
          fixtureChanges: [],
        },
        [
          {
            table: 'settings',
            op: 'update',
            where: { ...atLobby, key: 'entry.cap' },
            set: { hold: 'enforced', value: cap(40) },
          },
          {
            table: 'lobbies',
            op: 'update',
            id: 'cup',
            set: { settingsVersion: 3 },
          },
        ],
      ],
    });
  });

  test('enforced values', () => {
    assert({
      given: 'a key enforced above the scope',
      should: 'refuse setting-enforced',
      actual: refusalOf(
        facts({ rows: [row(league, 'entry.cap', cap(20), 'enforced')] }),
        set(cup, 'entry.cap', cap(40)),
      ),
      expected: 'setting-enforced',
    });
    assert({
      given:
        'an enforced value disagreeing with one enforced lower in a chain, and one agreeing',
      should: 'refuse enforced-conflict, and accept the agreeing one',
      actual: [
        refusalOf(
          facts({
            scope: { kind: 'organization', id: 'league', settingsVersion: 1 },
            rows: [row(template, 'entry.cap', cap(20), 'enforced')],
          }),
          set(league, 'entry.cap', cap(40), 'enforced'),
        ),
        refusalOf(
          facts({
            scope: { kind: 'organization', id: 'league', settingsVersion: 1 },
            rows: [row(template, 'entry.cap', cap(20), 'enforced')],
          }),
          set(league, 'entry.cap', cap(20), 'enforced'),
        ),
      ],
      expected: ['enforced-conflict', 'accepted'],
    });
  });

  test('a floor the pinned format forbids', () => {
    const atEventScope = {
      scope: { kind: 'event', id: 'ld', lobbyId: 'cup', settingsVersion: 7 },
      ownFormat: format,
    } as const;
    const atLeague = {
      scope: { kind: 'organization', id: 'league', settingsVersion: 1 },
    } as const;
    assert({
      given:
        'interruptions at an event whose format forbids them, the same enforced above it, and the same as a default above it',
      should:
        'refuse format-forbids for the first two, and leave the default to the formats that allow it',
      actual: [
        refusalOf(facts(atEventScope), set(ld, 'room.floor', floor(true))),
        refusalOf(
          facts(atLeague),
          set(league, 'room.floor', floor(true), 'enforced'),
        ),
        refusalOf(facts(atLeague), set(league, 'room.floor', floor(true))),
        refusalOf(facts(atEventScope), set(ld, 'room.floor', floor(false))),
      ],
      expected: ['format-forbids', 'format-forbids', 'accepted', 'accepted'],
    });
  });

  test('what an event holds', () => {
    const novice: SettingValues['entry.divisions'] = {
      items: [
        { key: 'novice', label: 'Novice', eligibility: { kind: 'open' } },
      ],
    };
    const inUse = facts({
      rows: [row(cup, 'entry.divisions', novice)],
      reached: [
        reached({ event: { ...holdings, divisionsInUse: ['novice'] } }),
      ],
    });
    assert({
      given:
        'a division list dropping a division entries carry, set or cleared',
      should: 'refuse division-in-use',
      actual: [
        refusalOf(inUse, set(cup, 'entry.divisions', { items: [] })),
        refusalOf(inUse, {
          type: 'clear-setting',
          scope: cup,
          key: 'entry.divisions',
        }),
      ],
      expected: ['division-in-use', 'division-in-use'],
    });
    assert({
      given: 'both qualifiers while two breaks share a slot, and otherwise',
      should: 'refuse breaks-share-slot, and accept',
      actual: [
        refusalOf(
          facts({
            reached: [
              reached({ event: { ...holdings, breaksShareSlot: true } }),
            ],
          }),
          set(cup, 'break.double_qualifier', { value: 'both' }),
        ),
        refusalOf(
          facts(),
          set(cup, 'break.double_qualifier', { value: 'both' }),
        ),
      ],
      expected: ['breaks-share-slot', 'accepted'],
    });

    const sanctioned = (rows: readonly SettingRow[]) =>
      facts({
        scope: { kind: 'event', id: 'ld', lobbyId: 'cup', settingsVersion: 7 },
        rows,
        reached: [
          reached({
            chain: copied,
            event: {
              ...holdings,
              sanction: {
                templateChain: [league, template],
                template: {
                  formatVersionId: 'ld@3',
                  ballotDefinitionVersionId: 'daisy',
                },
                event: {
                  formatVersionId: 'ld@3',
                  ballotDefinitionVersionId: 'daisy',
                },
              },
            },
          }),
        ],
      });
    const agreeing = [
      row(template, 'entry.cap', cap(20), 'enforced'),
      row(ld, 'entry.cap', cap(20)),
    ];
    assert({
      given:
        'a sanctioned event that copied its template, changing or clearing a value the template enforces',
      should: 'refuse sanction-holds, and accept a change elsewhere',
      actual: [
        refusalOf(sanctioned(agreeing), set(ld, 'entry.cap', cap(40))),
        refusalOf(sanctioned(agreeing), {
          type: 'clear-setting',
          scope: ld,
          key: 'entry.cap',
        }),
        refusalOf(
          sanctioned(agreeing),
          set(ld, 'entry.approval', { value: 'automatic' }),
        ),
      ],
      expected: ['sanction-holds', 'sanction-holds', 'accepted'],
    });
  });

  test('clearing', () => {
    assert({
      given: 'a row at the scope, none, and another scope than the facts hold',
      should: 'delete it, refuse setting-absent, and refuse not-found',
      actual: [
        writesOf(facts({ rows: [row(cup, 'entry.cap', cap(20))] }), {
          type: 'clear-setting',
          scope: cup,
          key: 'entry.cap',
        }),
        refusalOf(facts(), {
          type: 'clear-setting',
          scope: cup,
          key: 'entry.cap',
        }),
        refusalOf(facts(), {
          type: 'clear-setting',
          scope: league,
          key: 'entry.cap',
        }),
      ],
      expected: [
        [
          {
            table: 'settings',
            op: 'delete',
            where: { ...atLobby, key: 'entry.cap' },
          },
          {
            table: 'lobbies',
            op: 'update',
            id: 'cup',
            set: { settingsVersion: 3 },
          },
        ],
        'setting-absent',
        'not-found',
      ],
    });
  });
});

describe('decideSetting: templates', () => {
  const create = {
    type: 'create-template',
    organizationId: 'league',
    name: 'Varsity LD',
    format: { id: 'ld-format', version: 3 },
    ballotDefinition: { id: 'ballot', version: 1 },
  } as const;

  test('making a template', () => {
    assert({
      given: 'an available format and a ballot definition of the organization',
      should: 'make the template with its pins and no settings',
      actual: decideSetting(
        facts({
          ballotDefinition: { organizationId: 'league', lobbyId: null },
        }),
        create,
      ),
      expected: {
        kind: 'accepted',
        aggregate: { kind: 'template', id: 'new' },
        resultingVersion: 1,
        writes: [
          {
            table: 'templates',
            op: 'insert',
            row: {
              id: 'new',
              organizationId: 'league',
              name: 'Varsity LD',
              formatId: 'ld-format',
              formatVersion: 3,
              ballotDefinitionId: 'ballot',
              ballotDefinitionVersion: 1,
            },
          },
        ],
        findings: [],
        fixtureChanges: [],
      },
    });
    assert({
      given:
        'a taken name, a missing or foreign format, and a missing or lobby-owned ballot definition',
      should: 'refuse each with its name',
      actual: [
        refusalOf(facts({ nameTaken: true }), create),
        refusalOf(facts({ formatRevision: null }), create),
        refusalOf(
          facts({ formatRevision: { organizationId: 'other' } }),
          create,
        ),
        refusalOf(facts(), create),
        refusalOf(
          facts({ ballotDefinition: { organizationId: null, lobbyId: 'cup' } }),
          create,
        ),
        refusalOf(facts(), { ...create, ballotDefinition: null }),
      ],
      expected: [
        'name-taken',
        'format-unavailable',
        'format-unavailable',
        'illegal-definition',
        'illegal-definition',
        'accepted',
      ],
    });
  });

  test('revising and retiring change only the name and the retirement', () => {
    assert({
      given: 'a revision and a retirement',
      should: 'write the name, or the retirement, and never a pin',
      actual: [
        writesOf(facts(), {
          type: 'revise-template',
          templateId: 'tmpl',
          name: 'LD',
        }),
        writesOf(facts(), { type: 'retire-template', templateId: 'tmpl' }),
      ],
      expected: [
        [
          {
            table: 'templates',
            op: 'update',
            id: 'tmpl',
            set: { name: 'LD', version: 3 },
          },
        ],
        [
          {
            table: 'templates',
            op: 'update',
            id: 'tmpl',
            set: { retiredAt: now, version: 3 },
          },
        ],
      ],
    });
    assert({
      given: 'a taken name, and a template already retired',
      should: 'refuse name-taken and already-retired',
      actual: [
        refusalOf(facts({ nameTaken: true }), {
          type: 'revise-template',
          templateId: 'tmpl',
          name: 'LD',
        }),
        refusalOf(facts({ template: { ...templateRow, retiredAt: now } }), {
          type: 'retire-template',
          templateId: 'tmpl',
        }),
      ],
      expected: ['name-taken', 'already-retired'],
    });
  });

  test('offering and withdrawing', () => {
    const offer = {
      type: 'offer-template',
      lobbyId: 'cup',
      templateId: 'tmpl',
    } as const;
    const lobbyBump = {
      table: 'lobbies',
      op: 'update',
      id: 'cup',
      set: { version: 5 },
    } as const;
    const key = { lobbyId: 'cup', templateId: 'tmpl' };
    assert({
      given: 'a first offer, and an offer again after a withdrawal',
      should: 'insert the offer, or reopen it',
      actual: [
        writesOf(facts(), offer),
        writesOf(facts({ offer: { withdrawnAt: now } }), offer),
      ],
      expected: [
        [{ table: 'lobby_templates', op: 'insert', row: key }, lobbyBump],
        [
          {
            table: 'lobby_templates',
            op: 'update',
            key,
            set: { withdrawnAt: null },
          },
          lobbyBump,
        ],
      ],
    });
    assert({
      given:
        'a tournament lobby, a retired template, an open offer, and enforced values that disagree',
      should: 'refuse each with its name',
      actual: [
        refusalOf(
          facts({
            lobby: {
              id: 'cup',
              kind: 'tournament',
              ownerOrganizationId: null,
              version: 4,
            },
          }),
          offer,
        ),
        refusalOf(
          facts({ template: { ...templateRow, retiredAt: now } }),
          offer,
        ),
        refusalOf(facts({ offer: { withdrawnAt: null } }), offer),
        refusalOf(
          facts({
            rows: [
              row(template, 'entry.cap', cap(20), 'enforced'),
              row(cup, 'entry.cap', cap(40), 'enforced'),
            ],
          }),
          offer,
        ),
      ],
      expected: [
        'lobby-not-standing',
        'template-unavailable',
        'already-offered',
        'enforced-conflict',
      ],
    });
    assert({
      given: 'a withdrawal of an open offer, and of none',
      should: 'mark it withdrawn, and refuse not-offered',
      actual: [
        writesOf(facts({ offer: { withdrawnAt: null } }), {
          ...offer,
          type: 'withdraw-template',
        }),
        refusalOf(facts(), { ...offer, type: 'withdraw-template' }),
      ],
      expected: [
        [
          {
            table: 'lobby_templates',
            op: 'update',
            key,
            set: { withdrawnAt: now },
          },
          lobbyBump,
        ],
        'not-offered',
      ],
    });
  });

  const pins = {
    formatId: 'ld-format',
    formatVersion: 3,
    ballotDefinitionId: null,
    ballotDefinitionVersion: null,
  };
  const templateRows = [
    row(template, 'entry.cap', cap(20), 'enforced'),
    row(template, 'pairing.preset', { value: 'round_robin' }),
    row(template, 'pairing.rematch', { force: 'warning' }),
  ];

  test('copying', () => {
    const copy = {
      type: 'copy-template',
      eventId: 'ld',
      templateId: 'tmpl',
    } as const;
    assert({
      given:
        'a template whose values include a key no event may hold and one enforced above the event',
      should:
        'write the rest as the event’s own defaults, set the pins, keep no link, and report the skipped keys',
      actual: decideSetting(
        facts({
          rows: [
            ...templateRows,
            row(league, 'pairing.preset', { value: 'swiss_power' }, 'enforced'),
          ],
        }),
        copy,
      ),
      expected: {
        kind: 'accepted',
        aggregate: { kind: 'event', id: 'ld' },
        resultingVersion: 6,
        writes: [
          {
            table: 'settings',
            op: 'insert',
            row: {
              ...atEvent,
              key: 'entry.cap',
              hold: 'default',
              value: cap(20),
            },
          },
          {
            table: 'events',
            op: 'update',
            id: 'ld',
            set: { ...pins, version: 6, settingsVersion: 8 },
          },
        ],
        findings: [
          { kind: 'skipped', key: 'pairing.preset' },
          { kind: 'skipped', key: 'pairing.rematch' },
        ],
        fixtureChanges: [],
      },
    });
    assert({
      given: 'an event with entries, and a retired template',
      should: 'refuse entries-exist and template-unavailable',
      actual: [
        refusalOf(facts({ event: { ...event, entryCount: 1 } }), copy),
        refusalOf(
          facts({ template: { ...templateRow, retiredAt: now } }),
          copy,
        ),
      ],
      expected: ['entries-exist', 'template-unavailable'],
    });
  });

  test('following', () => {
    const follow = {
      type: 'follow-template',
      eventId: 'ld',
      templateId: 'tmpl',
    } as const;
    assert({
      given: 'an event with no entries and an available template',
      should: 'link the event and set its pins',
      actual: writesOf(facts(), follow),
      expected: [
        {
          table: 'events',
          op: 'update',
          id: 'ld',
          set: { templateId: 'tmpl', ...pins, version: 6, settingsVersion: 8 },
        },
      ],
    });
    assert({
      given:
        'entries, an existing link, a retired template, and disagreeing enforced values',
      should: 'refuse each with its name',
      actual: [
        refusalOf(facts({ event: { ...event, entryCount: 2 } }), follow),
        refusalOf(
          facts({
            event: {
              ...event,
              templateId: 'other',
              templateOrganizationId: 'league',
            },
          }),
          follow,
        ),
        refusalOf(
          facts({ template: { ...templateRow, retiredAt: now } }),
          follow,
        ),
        refusalOf(
          facts({
            rows: [
              row(template, 'entry.cap', cap(20), 'enforced'),
              row(cup, 'entry.cap', cap(30), 'enforced'),
            ],
          }),
          follow,
        ),
      ],
      expected: [
        'entries-exist',
        'already-following',
        'template-unavailable',
        'enforced-conflict',
      ],
    });
    assert({
      given: 'a retired template an event already follows',
      should:
        'keep it following: a change to its own settings is still accepted',
      actual: refusalOf(
        facts({
          template: { ...templateRow, retiredAt: now },
          event: {
            ...event,
            templateId: 'tmpl',
            templateOrganizationId: 'league',
          },
          scope: {
            kind: 'event',
            id: 'ld',
            lobbyId: 'cup',
            settingsVersion: 7,
          },
        }),
        set(ld, 'entry.approval', { value: 'automatic' }),
      ),
      expected: 'accepted',
    });
  });

  test('stopping following', () => {
    const stop = { type: 'stop-following-template', eventId: 'ld' } as const;
    const follower = {
      ...event,
      templateId: 'tmpl',
      templateOrganizationId: 'league',
    };
    assert({
      given: 'an event following a template',
      should:
        'write the template’s values as the event’s own, then remove the link',
      actual: decideSetting(
        facts({
          event: follower,
          rows: [row(template, 'entry.cap', cap(20), 'enforced')],
        }),
        stop,
      ),
      expected: {
        kind: 'accepted',
        aggregate: { kind: 'event', id: 'ld' },
        resultingVersion: 6,
        writes: [
          {
            table: 'settings',
            op: 'insert',
            row: {
              ...atEvent,
              key: 'entry.cap',
              hold: 'default',
              value: cap(20),
            },
          },
          {
            table: 'events',
            op: 'update',
            id: 'ld',
            set: { templateId: null, version: 6, settingsVersion: 8 },
          },
        ],
        findings: [],
        fixtureChanges: [],
      },
    });
    assert({
      given:
        'an event following nothing, and a sanctioned event whose template enforces a key no event may hold',
      should: 'refuse not-following and sanction-holds',
      actual: [
        refusalOf(facts(), stop),
        refusalOf(
          facts({
            rows: [
              row(
                template,
                'pairing.rematch',
                { force: 'warning' },
                'enforced',
              ),
            ],
            event: {
              ...follower,
              sanction: {
                templateChain: [league, template],
                template: {
                  formatVersionId: 'ld@3',
                  ballotDefinitionVersionId: 'daisy',
                },
                event: {
                  formatVersionId: 'ld@3',
                  ballotDefinitionVersionId: 'daisy',
                },
              },
            },
          }),
          stop,
        ),
      ],
      expected: ['not-following', 'sanction-holds'],
    });
  });
});
