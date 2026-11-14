import type {
  SettingCommand,
  SettingRefusal,
} from '@daisy/protocol/lobby/setting-command';
import type { CommandFinding } from '@daisy/protocol/lobby/command';
import type { LobbyKind } from '@daisy/protocol/lobby';
import { sanctionCheck } from '@daisy/protocol/sanction-check';
import {
  enforcedConflict,
  eventChain,
  resolveSetting,
  resolveSettings,
  withoutSettingRow,
  withSettingRow,
  type FormatSettingDefaults,
  type SettingChain,
} from '@daisy/protocol/setting-resolution';
import {
  settingKeys,
  settingsCatalogue,
  type SettingHold,
  type SettingRow,
  type SettingScope,
} from '@daisy/protocol/settings';
import type { SettingKey } from '@daisy/protocol/setting-values';
import { refuse, type CommandDecision } from './run-command';

/**
 * The setting and template commands' decisions (TAB-5.19). A value already
 * fits its key, scope and hold when it arrives (the payload schema holds
 * that); what is decided here spans rows: the chains through the scope, the
 * pinned formats, the entries, the breaks and an approved sanction. Enforced
 * values never disagree along a chain, decided by the resolver's own
 * `enforcedConflict`.
 */

/** The scope a setting command writes, with its isolation key and settings version. */
export type SettingScopeFact =
  | {
      readonly kind: 'organization';
      readonly id: string;
      readonly settingsVersion: number;
    }
  | {
      readonly kind: 'template';
      readonly id: string;
      readonly organizationId: string;
      readonly settingsVersion: number;
    }
  | {
      readonly kind: 'lobby';
      readonly id: string;
      readonly settingsVersion: number;
    }
  | {
      readonly kind: 'event';
      readonly id: string;
      readonly lobbyId: string;
      readonly settingsVersion: number;
    };

/** The pins a sanction compares, and the chain of the template it names. */
export type SanctionFact = {
  readonly templateChain: SettingChain;
  readonly template: {
    readonly formatVersionId: string;
    readonly ballotDefinitionVersionId: string;
  };
  readonly event: {
    readonly formatVersionId: string;
    readonly ballotDefinitionVersionId: string;
  };
};

/** What an event holds that a setting change may not break. */
export type EventHoldings = {
  /** The division keys its entries carry. */
  readonly divisionsInUse: readonly string[];
  /** Whether two of its breaks share a time slot. */
  readonly breaksShareSlot: boolean;
  /** Its approved sanction, if it has one. */
  readonly sanction: SanctionFact | null;
};

/**
 * One chain that reads the scope written: an event's or a standing-lobby
 * Room's, with its pinned format; for a scope nothing reads yet, its own
 * chain ending at it, with no format.
 */
export type ReachedChain = {
  readonly chain: SettingChain;
  readonly format: FormatSettingDefaults | null;
  readonly event: EventHoldings | null;
};

/** A `templates` row. */
export type TemplateRow = {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly formatId: string;
  readonly formatVersion: number;
  readonly ballotDefinitionId: string | null;
  readonly ballotDefinitionVersion: number | null;
  readonly retiredAt: string | null;
  readonly version: number;
  /** The values its pinned format gives the keys that default to it. */
  readonly format: FormatSettingDefaults;
};

/** An `events` row, with what its commands read. */
export type EventFact = EventHoldings & {
  readonly id: string;
  readonly lobbyId: string;
  /** The league that owns the tournament, if one does. */
  readonly leagueId: string | null;
  readonly templateId: string | null;
  readonly templateOrganizationId: string | null;
  readonly version: number;
  readonly settingsVersion: number;
  readonly entryCount: number;
  readonly format: FormatSettingDefaults;
};

export type LobbyFact = {
  readonly id: string;
  readonly kind: LobbyKind;
  readonly ownerOrganizationId: string | null;
  readonly version: number;
};

export type SettingFacts = {
  readonly now: string;
  /** The id minted at the edge for a template a command makes. */
  readonly newId: string;
  /** Every settings row on every chain the command reads. */
  readonly rows: readonly SettingRow[];
  /** For `set-setting` and `clear-setting`. */
  readonly scope: SettingScopeFact | null;
  readonly reached: readonly ReachedChain[];
  /** The scope's own pinned format: a template's or an event's. */
  readonly ownFormat: FormatSettingDefaults | null;
  readonly template: TemplateRow | null;
  readonly event: EventFact | null;
  readonly lobby: LobbyFact | null;
  /** The `lobby_templates` row for the lobby and template named. */
  readonly offer: { readonly withdrawnAt: string | null } | null;
  /** Whether another template of the organization has the name. */
  readonly nameTaken: boolean;
  /** For `create-template`: the format revision named, and who owns it. */
  readonly formatRevision: { readonly organizationId: string | null } | null;
  /** For `create-template`: the ballot definition version named. */
  readonly ballotDefinition: {
    readonly organizationId: string | null;
    readonly lobbyId: string | null;
  } | null;
};

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
  /** The row's id is minted where the write is applied. */
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

export type SettingDecisionRefusal =
  SettingRefusal | 'not-found' | 'name-taken';
type Decision = CommandDecision<SettingDecisionRefusal, SettingWrite>;

const sameScope = (a: SettingScope, b: SettingScope): boolean =>
  a.kind === b.kind && a.id === b.id;

const columnsOf = (scope: SettingScopeFact): ScopeColumns => {
  const none = {
    organizationId: null,
    templateId: null,
    lobbyId: null,
    eventId: null,
  };
  switch (scope.kind) {
    case 'organization':
      return { ...none, scopeKind: scope.kind, organizationId: scope.id };
    case 'template':
      return {
        ...none,
        scopeKind: scope.kind,
        templateId: scope.id,
        organizationId: scope.organizationId,
      };
    case 'lobby':
      return { ...none, scopeKind: scope.kind, lobbyId: scope.id };
    case 'event':
      return {
        ...none,
        scopeKind: scope.kind,
        eventId: scope.id,
        lobbyId: scope.lobbyId,
      };
  }
};

const scopeTable = {
  organization: 'organizations',
  template: 'templates',
  lobby: 'lobbies',
  event: 'events',
} as const;

const accepted = (
  aggregate: { readonly kind: SettingScope['kind']; readonly id: string },
  resultingVersion: number,
  writes: readonly SettingWrite[],
  findings: readonly CommandFinding[] = [],
): Decision => ({
  kind: 'accepted',
  aggregate,
  resultingVersion,
  writes,
  findings,
  fixtureChanges: [],
});

const rowAt = (
  rows: readonly SettingRow[],
  scope: SettingScope,
  key: SettingKey,
): SettingRow | undefined =>
  rows.find((row) => row.key === key && sameScope(row.scope, scope));

/** Whether a scope above `scope` in the chain enforces the key. */
const enforcedAbove = (
  key: SettingKey,
  chain: SettingChain,
  scope: SettingScope,
  rows: readonly SettingRow[],
): boolean => {
  const at = chain.findIndex((candidate) => sameScope(candidate, scope));
  const above = at < 0 ? chain : chain.slice(0, at);
  return rows.some(
    (row) =>
      row.key === key &&
      row.hold === 'enforced' &&
      above.some((candidate) => sameScope(candidate, row.scope)),
  );
};

/** A floor fits a format when it is null exactly where the format forbids. */
const floorFits = (
  value: FormatSettingDefaults['room.floor'],
  format: FormatSettingDefaults,
): boolean =>
  (value.interruptions === null) ===
    (format['room.floor'].interruptions === null) &&
  (value.yielding === null) === (format['room.floor'].yielding === null);

/** The values a template's chain enforces. */
const enforcedBy = (
  chain: SettingChain,
  rows: readonly SettingRow[],
  format: FormatSettingDefaults,
) =>
  settingKeys.flatMap((key) => {
    const resolved = resolveSetting(key, chain, rows, format);
    return resolved.hold === 'enforced' ? [{ key, value: resolved.value }] : [];
  });

const sanctionPasses = (
  sanction: SanctionFact,
  chain: SettingChain,
  rows: readonly SettingRow[],
  format: FormatSettingDefaults,
): boolean =>
  sanctionCheck(
    {
      ...sanction.template,
      enforced: enforcedBy(sanction.templateChain, rows, format),
    },
    { ...sanction.event, resolved: resolveSettings(chain, rows, format) },
  ).passes;

/**
 * What an event holds that the rows after a change would break: a division
 * its entries carry, `both` qualifiers while breaks share a slot, or an
 * approved sanction's check.
 */
function brokenHolding(
  event: EventHoldings,
  chain: SettingChain,
  format: FormatSettingDefaults,
  before: readonly SettingRow[],
  after: readonly SettingRow[],
): SettingRefusal | null {
  const divisions = new Set(
    resolveSetting('entry.divisions', chain, after, format).value.items.map(
      (division) => division.key,
    ),
  );
  if (!event.divisionsInUse.every((key) => divisions.has(key)))
    return 'division-in-use';
  if (
    event.breaksShareSlot &&
    resolveSetting('break.double_qualifier', chain, after, format).value
      .value === 'both'
  )
    return 'breaks-share-slot';
  if (
    event.sanction !== null &&
    sanctionPasses(event.sanction, chain, before, format) &&
    !sanctionPasses(event.sanction, chain, after, format)
  )
    return 'sanction-holds';
  return null;
}

const firstBroken = (
  reached: readonly ReachedChain[],
  before: readonly SettingRow[],
  after: readonly SettingRow[],
): SettingRefusal | null => {
  for (const { chain, format, event } of reached) {
    const broken =
      event && format
        ? brokenHolding(event, chain, format, before, after)
        : null;
    if (broken) return broken;
  }
  return null;
};

const bumpScope = (scope: SettingScopeFact): SettingWrite => ({
  table: scopeTable[scope.kind],
  op: 'update',
  id: scope.id,
  set: { settingsVersion: scope.settingsVersion + 1 },
});

function setSetting(
  facts: SettingFacts,
  scope: SettingScopeFact,
  command: Extract<SettingCommand, { type: 'set-setting' }>,
): Decision {
  const { key, hold, value } = command;
  const written: SettingRow = {
    scope: command.scope,
    key,
    hold,
    value,
  } as SettingRow;
  if (
    facts.reached.some(({ chain }) =>
      enforcedAbove(key, chain, command.scope, facts.rows),
    )
  )
    return refuse('setting-enforced');
  if (key === 'room.floor') {
    const floor = value as FormatSettingDefaults['room.floor'];
    const formats = [
      facts.ownFormat,
      ...(hold === 'enforced'
        ? facts.reached.map((reached) => reached.format)
        : []),
    ].filter((format) => format !== null);
    if (!formats.every((format) => floorFits(floor, format)))
      return refuse('format-forbids');
  }
  const after = withSettingRow(facts.rows, written);
  if (
    facts.reached.some(
      ({ chain }) => enforcedConflict(key, chain, after) !== null,
    )
  )
    return refuse('enforced-conflict');
  const broken = firstBroken(facts.reached, facts.rows, after);
  if (broken) return refuse(broken);
  const where = { ...columnsOf(scope), key };
  return accepted(command.scope, scope.settingsVersion + 1, [
    rowAt(facts.rows, command.scope, key)
      ? { table: 'settings', op: 'update', where, set: { hold, value } }
      : { table: 'settings', op: 'insert', row: { ...where, hold, value } },
    bumpScope(scope),
  ]);
}

function clearSetting(
  facts: SettingFacts,
  scope: SettingScopeFact,
  command: Extract<SettingCommand, { type: 'clear-setting' }>,
): Decision {
  if (!rowAt(facts.rows, command.scope, command.key))
    return refuse('setting-absent');
  const after = withoutSettingRow(facts.rows, command.scope, command.key);
  const broken = firstBroken(facts.reached, facts.rows, after);
  if (broken) return refuse(broken);
  return accepted(command.scope, scope.settingsVersion + 1, [
    {
      table: 'settings',
      op: 'delete',
      where: { ...columnsOf(scope), key: command.key },
    },
    bumpScope(scope),
  ]);
}

function createTemplate(
  facts: SettingFacts,
  command: Extract<SettingCommand, { type: 'create-template' }>,
): Decision {
  if (facts.nameTaken) return refuse('name-taken');
  const ownable = (owner: string | null) =>
    owner === null || owner === command.organizationId;
  if (!facts.formatRevision || !ownable(facts.formatRevision.organizationId))
    return refuse('format-unavailable');
  if (
    command.ballotDefinition !== null &&
    (!facts.ballotDefinition ||
      facts.ballotDefinition.lobbyId !== null ||
      !ownable(facts.ballotDefinition.organizationId))
  )
    return refuse('illegal-definition');
  // Made with no settings; its pins never change afterwards.
  return accepted({ kind: 'template', id: facts.newId }, 1, [
    {
      table: 'templates',
      op: 'insert',
      row: {
        id: facts.newId,
        organizationId: command.organizationId,
        name: command.name,
        formatId: command.format.id,
        formatVersion: command.format.version,
        ballotDefinitionId: command.ballotDefinition?.id ?? null,
        ballotDefinitionVersion: command.ballotDefinition?.version ?? null,
      },
    },
  ]);
}

const pinsOf = (template: TemplateRow): Pins => ({
  formatId: template.formatId,
  formatVersion: template.formatVersion,
  ballotDefinitionId: template.ballotDefinitionId,
  ballotDefinitionVersion: template.ballotDefinitionVersion,
});

const templateChain = (template: TemplateRow): SettingChain => [
  { kind: 'organization', id: template.organizationId },
  { kind: 'template', id: template.id },
];

/** The first key whose enforced values disagree along the chain, if any. */
const anyEnforcedConflict = (
  chain: SettingChain,
  rows: readonly SettingRow[],
) => settingKeys.some((key) => enforcedConflict(key, chain, rows) !== null);

function offerTemplate(
  facts: SettingFacts,
  lobby: LobbyFact,
  template: TemplateRow | null,
): Decision {
  if (lobby.kind !== 'standing') return refuse('lobby-not-standing');
  if (template === null || template.retiredAt !== null)
    return refuse('template-unavailable');
  if (facts.offer && facts.offer.withdrawnAt === null)
    return refuse('already-offered');
  const chain: SettingChain = [
    ...templateChain(template),
    ...(lobby.ownerOrganizationId &&
    lobby.ownerOrganizationId !== template.organizationId
      ? [{ kind: 'organization' as const, id: lobby.ownerOrganizationId }]
      : []),
    { kind: 'lobby', id: lobby.id },
  ];
  if (anyEnforcedConflict(chain, facts.rows))
    return refuse('enforced-conflict');
  const key = { lobbyId: lobby.id, templateId: template.id };
  return accepted({ kind: 'lobby', id: lobby.id }, lobby.version + 1, [
    facts.offer
      ? {
          table: 'lobby_templates',
          op: 'update',
          key,
          set: { withdrawnAt: null },
        }
      : { table: 'lobby_templates', op: 'insert', row: key },
    {
      table: 'lobbies',
      op: 'update',
      id: lobby.id,
      set: { version: lobby.version + 1 },
    },
  ]);
}

function withdrawTemplate(
  facts: SettingFacts,
  lobby: LobbyFact,
  templateId: string,
): Decision {
  if (lobby.kind !== 'standing') return refuse('lobby-not-standing');
  if (!facts.offer || facts.offer.withdrawnAt !== null)
    return refuse('not-offered');
  // Rooms already made keep following.
  return accepted({ kind: 'lobby', id: lobby.id }, lobby.version + 1, [
    {
      table: 'lobby_templates',
      op: 'update',
      key: { lobbyId: lobby.id, templateId },
      set: { withdrawnAt: facts.now },
    },
    {
      table: 'lobbies',
      op: 'update',
      id: lobby.id,
      set: { version: lobby.version + 1 },
    },
  ]);
}

const chainOf = (
  event: EventFact,
  template: TemplateRow | null,
): SettingChain =>
  eventChain({
    template: template
      ? { id: template.id, organizationId: template.organizationId }
      : null,
    leagueId: event.leagueId,
    lobbyId: event.lobbyId,
    eventId: event.id,
  });

const eventScope = (event: EventFact): SettingScopeFact => ({
  kind: 'event',
  id: event.id,
  lobbyId: event.lobbyId,
  settingsVersion: event.settingsVersion,
});

/**
 * Writes values into the event's own rows at hold `default`; a key the event
 * may not hold, or one enforced above it, is skipped and reported.
 */
function writeIntoEvent(
  event: EventFact,
  chain: SettingChain,
  rows: readonly SettingRow[],
  values: readonly { readonly key: SettingKey; readonly value: unknown }[],
) {
  const scope = eventScope(event);
  const at: SettingScope = { kind: 'event', id: event.id };
  const writes: SettingWrite[] = [];
  const findings: CommandFinding[] = [];
  let after = rows;
  for (const { key, value } of values) {
    if (
      !settingsCatalogue[key].scopes.includes('event') ||
      enforcedAbove(key, chain, at, rows)
    ) {
      findings.push({ kind: 'skipped', key });
      continue;
    }
    const where = { ...columnsOf(scope), key };
    writes.push(
      rowAt(rows, at, key)
        ? {
            table: 'settings',
            op: 'update',
            where,
            set: { hold: 'default', value },
          }
        : {
            table: 'settings',
            op: 'insert',
            row: { ...where, hold: 'default', value },
          },
    );
    after = withSettingRow(after, {
      scope: at,
      key,
      hold: 'default',
      value,
    } as SettingRow);
  }
  return { writes, findings, after };
}

const eventUpdate = (
  event: EventFact,
  set: Partial<Pins> & { readonly templateId?: string | null },
): SettingWrite => ({
  table: 'events',
  op: 'update',
  id: event.id,
  set: {
    ...set,
    version: event.version + 1,
    settingsVersion: event.settingsVersion + 1,
  },
});

function copyTemplate(
  facts: SettingFacts,
  event: EventFact,
  template: TemplateRow | null,
): Decision {
  if (event.entryCount > 0) return refuse('entries-exist');
  if (template === null || template.retiredAt !== null)
    return refuse('template-unavailable');
  // No link is kept: the template's own values become the event's.
  const own = facts.rows.filter((row) =>
    sameScope(row.scope, { kind: 'template', id: template.id }),
  );
  const copied = writeIntoEvent(event, chainOf(event, null), facts.rows, own);
  return accepted(
    { kind: 'event', id: event.id },
    event.version + 1,
    [...copied.writes, eventUpdate(event, pinsOf(template))],
    copied.findings,
  );
}

function followTemplate(
  facts: SettingFacts,
  event: EventFact,
  template: TemplateRow | null,
): Decision {
  if (event.entryCount > 0) return refuse('entries-exist');
  if (event.templateId !== null) return refuse('already-following');
  if (template === null || template.retiredAt !== null)
    return refuse('template-unavailable');
  if (anyEnforcedConflict(chainOf(event, template), facts.rows))
    return refuse('enforced-conflict');
  return accepted({ kind: 'event', id: event.id }, event.version + 1, [
    eventUpdate(event, { templateId: template.id, ...pinsOf(template) }),
  ]);
}

/** The template's values become the event's own, then the link goes, so no resolved value changes. */
function stopFollowing(facts: SettingFacts, event: EventFact): Decision {
  if (event.templateId === null || event.templateOrganizationId === null)
    return refuse('not-following');
  const before = eventChain({
    template: {
      id: event.templateId,
      organizationId: event.templateOrganizationId,
    },
    leagueId: event.leagueId,
    lobbyId: event.lobbyId,
    eventId: event.id,
  });
  const after = chainOf(event, null);
  const leaving = settingKeys.flatMap((key) => {
    const resolved = resolveSetting(key, before, facts.rows, event.format);
    const source = resolved.source;
    const fromLeaving =
      (source.kind === 'organization' || source.kind === 'template') &&
      !after.some((scope) => sameScope(scope, source));
    return fromLeaving ? [{ key, value: resolved.value as unknown }] : [];
  });
  const kept = writeIntoEvent(event, after, facts.rows, leaving);
  if (
    event.sanction !== null &&
    sanctionPasses(event.sanction, before, facts.rows, event.format) &&
    !sanctionPasses(event.sanction, after, kept.after, event.format)
  )
    return refuse('sanction-holds');
  return accepted(
    { kind: 'event', id: event.id },
    event.version + 1,
    [...kept.writes, eventUpdate(event, { templateId: null })],
    kept.findings,
  );
}

const sameTarget = (
  scope: SettingScopeFact | null,
  command: { readonly scope: SettingScope },
) =>
  scope !== null &&
  scope.kind === command.scope.kind &&
  scope.id === command.scope.id
    ? scope
    : null;

type TemplateRowCommand = Extract<
  SettingCommand,
  { type: 'revise-template' | 'retire-template' }
>;
/** Only the name and the retirement change; the pins never do. */
function reviseOrRetire(
  facts: SettingFacts,
  command: TemplateRowCommand,
): Decision {
  const template = facts.template;
  if (template?.id !== command.templateId) return refuse('not-found');
  if (command.type === 'revise-template' && facts.nameTaken)
    return refuse('name-taken');
  if (command.type === 'retire-template' && template.retiredAt !== null)
    return refuse('already-retired');
  const version = template.version + 1;
  return accepted({ kind: 'template', id: template.id }, version, [
    {
      table: 'templates',
      op: 'update',
      id: template.id,
      set:
        command.type === 'revise-template'
          ? { name: command.name, version }
          : { retiredAt: facts.now, version },
    },
  ]);
}

const templateNamed = (facts: SettingFacts, templateId: string) =>
  facts.template?.id === templateId ? facts.template : null;

function onLobby(
  facts: SettingFacts,
  command: Extract<
    SettingCommand,
    { type: 'offer-template' | 'withdraw-template' }
  >,
): Decision {
  const lobby = facts.lobby;
  if (lobby?.id !== command.lobbyId) return refuse('not-found');
  return command.type === 'offer-template'
    ? offerTemplate(facts, lobby, templateNamed(facts, command.templateId))
    : withdrawTemplate(facts, lobby, command.templateId);
}

function onEvent(
  facts: SettingFacts,
  command: Extract<
    SettingCommand,
    { type: 'copy-template' | 'follow-template' | 'stop-following-template' }
  >,
): Decision {
  const event = facts.event;
  if (event?.id !== command.eventId) return refuse('not-found');
  switch (command.type) {
    case 'copy-template':
      return copyTemplate(
        facts,
        event,
        templateNamed(facts, command.templateId),
      );
    case 'follow-template':
      return followTemplate(
        facts,
        event,
        templateNamed(facts, command.templateId),
      );
    case 'stop-following-template':
      return stopFollowing(facts, event);
  }
}

/** Decides one setting or template command against its facts. */
export function decideSetting(
  facts: SettingFacts,
  command: SettingCommand,
): Decision {
  switch (command.type) {
    case 'set-setting':
    case 'clear-setting': {
      const scope = sameTarget(facts.scope, command);
      if (scope === null) return refuse('not-found');
      return command.type === 'set-setting'
        ? setSetting(facts, scope, command)
        : clearSetting(facts, scope, command);
    }
    case 'create-template':
      return createTemplate(facts, command);
    case 'revise-template':
    case 'retire-template':
      return reviseOrRetire(facts, command);
    case 'offer-template':
    case 'withdraw-template':
      return onLobby(facts, command);
    case 'copy-template':
    case 'follow-template':
    case 'stop-following-template':
      return onEvent(facts, command);
  }
}
