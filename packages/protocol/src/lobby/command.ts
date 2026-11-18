import type { pendingCommandStatuses } from './vocabulary';
import { z } from 'zod';
import type { AuthorizationCapability } from '../authorization';
import { idSchema } from '../primitives';

/**
 * The one shape every lobby, organization and tab command shares (TAB-5.8):
 * one envelope, one receipt, one answer union and one action-history entry.
 * Each command group owns its own discriminated union and catalogue; this
 * file owns only what they have in common.
 */

/** What a command changes. A settings command's aggregate is the scope it writes. */
export const lobbyAggregateKinds = [
  'organization',
  'league_school',
  'guardian_link',
  'template',
  'lobby',
  'room',
  'season',
  'event',
  'draw',
  'fixture',
  'ballot',
  'result',
  'release',
  'sanction',
  'pending_command',
] as const;
export type LobbyAggregateKind = (typeof lobbyAggregateKinds)[number];
const lobbyAggregateKindSchema = z.enum(lobbyAggregateKinds);

/**
 * The versions a command may read, by name. A command names each one it
 * checks in its envelope's `expected`; a creation command names none.
 */
const commandVersionNames = [
  'organization',
  'membership',
  'guardianLink',
  'template',
  'lobby',
  'season',
  'event',
  'entries',
  'settings',
  'timeSlot',
  'draw',
  'fixture',
  'results',
  'sanction',
  'pendingCommand',
] as const;
export type CommandVersionName = (typeof commandVersionNames)[number];

const versionSchema = z.int().positive();
const commandExpectedSchema = z.strictObject(
  Object.fromEntries(
    commandVersionNames.map((name) => [name, versionSchema.optional()]),
  ) as {
    readonly [Name in CommandVersionName]: z.ZodOptional<typeof versionSchema>;
  },
);
export type CommandExpected = z.infer<typeof commandExpectedSchema>;

/**
 * Refusals every command may answer, beside its own closed list. An
 * authorization denial is a public error, never a refusal.
 */
export const sharedLobbyRefusals = [
  'version-conflict',
  'command-conflict',
  'not-found',
  'settings-inherited',
  'lobby-closed',
  'name-taken',
] as const;
export type SharedLobbyRefusal = (typeof sharedLobbyRefusals)[number];

/** The one envelope: the Round shape with kebab-case command types. */
export const lobbyCommandEnvelope = <Command extends z.ZodType>(
  command: Command,
) =>
  z.strictObject({
    version: z.literal(1),
    commandId: idSchema,
    expected: commandExpectedSchema,
    command,
  });
export type LobbyCommandEnvelope<Command> = {
  readonly version: 1;
  readonly commandId: string;
  readonly expected: CommandExpected;
  readonly command: Command;
};

/**
 * What a command's catalogue entry must say, so a command with no gate, no
 * refusals or no history entry cannot be declared (TAB-5.16).
 */
export type LobbyCommandDefinition<Refusal extends string = string> = {
  readonly aggregate: LobbyAggregateKind;
  /** The capabilities that may send it; any one of them is enough. */
  readonly gate: readonly [
    AuthorizationCapability,
    ...AuthorizationCapability[],
  ];
  /** The versions it checks, by name; empty for a creation command. */
  readonly versions: readonly CommandVersionName[];
  /** Its own closed refusals, beside the shared ones. */
  readonly refusals: readonly Refusal[];
  /** Every accepted command leaves one action-history entry. */
  readonly history: 'entry';
};

/** One definition per member of a command union, keyed by its type. */
export type LobbyCommandCatalogue<Command extends { readonly type: string }> = {
  readonly [Type in Command['type']]: LobbyCommandDefinition;
};

/**
 * What the command met beside its answer: a broken rule (on a draft only;
 * publishing refuses it without an override), a bent preference, a warning,
 * or a key it skipped.
 */
const commandFindingSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.enum(['rule', 'preference', 'warning']),
    key: z.string().min(1),
    detail: z.string().min(1),
  }),
  z.strictObject({ kind: z.literal('skipped'), key: z.string().min(1) }),
]);
export type CommandFinding = z.infer<typeof commandFindingSchema>;

/**
 * What changed for people: the fixtures a published draw version added or
 * withdrew since the version before (a first version adds every fixture), or
 * one officiating command. `people` are the accounts seated before or after
 * (TAB-5.22).
 */
export const fixtureChangeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.enum(['added', 'withdrawn']),
    fixtureId: idSchema,
    tabRoundId: idSchema,
    drawVersion: z.int().positive(),
    people: z.array(idSchema),
  }),
  z.strictObject({
    kind: z.literal('officiated'),
    fixtureId: idSchema,
    tabRoundId: idSchema,
    commandId: idSchema,
    type: z.string().min(1),
    people: z.array(idSchema),
  }),
]);
export type FixtureChange = z.infer<typeof fixtureChangeSchema>;

export const lobbyCommandReceiptSchema = z.strictObject({
  commandId: idSchema,
  aggregate: z.strictObject({ kind: lobbyAggregateKindSchema, id: idSchema }),
  resultingVersion: z.int().positive(),
  replayed: z.boolean(),
  findings: z.array(commandFindingSchema),
  fixtureChanges: z.array(fixtureChangeSchema),
});
export type LobbyCommandReceipt = z.infer<typeof lobbyCommandReceiptSchema>;

/** A held proposal settled without applying its command; replay preserves its actual status and deadline. */
export type SettledLobbyCommand = {
  readonly kind: 'settled';
  readonly pendingCommandId: string;
  readonly status: Exclude<
    (typeof pendingCommandStatuses)[number],
    'pending' | 'confirmed'
  >;
  readonly expiresAt: string;
};

/**
 * The one answer. A command a conflict holds for a second person is stored
 * whole and answered `pending`; nothing changes until it is confirmed.
 */
export type LobbyCommandAnswer<Refusal extends string = string> =
  | SettledLobbyCommand
  | { readonly kind: 'accepted'; readonly receipt: LobbyCommandReceipt }
  | {
      readonly kind: 'pending';
      readonly pendingCommandId: string;
      readonly expiresAt: string;
    }
  | {
      readonly kind: 'refused';
      readonly refusal: Refusal | SharedLobbyRefusal;
      /** The people a refusal is about, where it names them (`slot-clash`). */
      readonly people?: readonly string[];
    };

/** Who a command was accepted under: the evaluator's authority, or a service. */
export const historyAuthoritySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('fixed') }),
  z.strictObject({ kind: z.literal('owner') }),
  z.strictObject({ kind: z.literal('grant'), grantId: idSchema }),
  z.strictObject({
    kind: z.literal('relationship'),
    relation: z.string().min(1),
  }),
  z.strictObject({ kind: z.literal('service'), serviceId: z.string().min(1) }),
]);
export type HistoryAuthority = z.infer<typeof historyAuthoritySchema>;

/**
 * One action-history entry, appended once per accepted command and never
 * otherwise. It is the replay record: the same command id
 * with the same digest replays its receipt, with another digest is refused.
 * Competitive history is retained; family history activation and retention
 * remain counsel-gated.
 */
export const actionHistoryEntrySchema = z.strictObject({
  commandId: idSchema,
  scope: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('organization'),
      organizationId: idSchema,
    }),
    z.strictObject({ kind: z.literal('lobby'), lobbyId: idSchema }),
    z.strictObject({ kind: z.literal('person'), subjectUserId: idSchema }),
  ]),
  aggregate: z.strictObject({ kind: lobbyAggregateKindSchema, id: idSchema }),
  type: z.string().min(1),
  actorUserId: idSchema.nullable(),
  authority: historyAuthoritySchema,
  conflictId: idSchema.nullable(),
  confirmedByUserId: idSchema.nullable(),
  payloadDigest: z.string().regex(/^[0-9a-f]{64}$/),
  resultingVersion: z.int().positive(),
  appliedAt: z.iso.datetime(),
});
export type ActionHistoryEntry = z.infer<typeof actionHistoryEntrySchema>;

/**
 * Whether a command's expected versions still hold: every version it names
 * equals the current one. A version the aggregate does not have (a windowed
 * stage has no slot) is matched by naming none. The runner and confirmation
 * both decide staleness by this one rule.
 */
export const versionsHold = (
  names: readonly CommandVersionName[],
  expected: CommandExpected,
  current: CommandExpected,
): boolean => names.every((name) => expected[name] === current[name]);

/** What the record holds for a command id: its accepted receipt, or its hold. */
export type StoredOutcome =
  | SettledLobbyCommand
  | { readonly kind: 'accepted'; readonly receipt: LobbyCommandReceipt }
  | {
      readonly kind: 'pending';
      readonly pendingCommandId: string;
      readonly expiresAt: string;
    };

/** What the stored record says about a command id that arrives again. */
export type CommandReplay =
  | SettledLobbyCommand
  | { readonly kind: 'new' }
  | { readonly kind: 'replay'; readonly receipt: LobbyCommandReceipt }
  | {
      readonly kind: 'pending';
      readonly pendingCommandId: string;
      readonly expiresAt: string;
    }
  | { readonly kind: 'conflict' };

/**
 * Replay is decided by command id and digest before any version is checked:
 * the same actor and content replays what was answered (the receipt, or the
 * same hold while it waits), anything else is `command-conflict`.
 */
export const commandReplay = (
  stored: {
    readonly actorUserId: string | null;
    readonly payloadDigest: string;
    readonly outcome: StoredOutcome;
  } | null,
  arriving: {
    readonly actorUserId: string | null;
    readonly payloadDigest: string;
  },
): CommandReplay => {
  if (stored === null) return { kind: 'new' };
  if (
    stored.actorUserId !== arriving.actorUserId ||
    stored.payloadDigest !== arriving.payloadDigest
  )
    return { kind: 'conflict' };
  const { outcome } = stored;
  return outcome.kind === 'accepted'
    ? { kind: 'replay', receipt: { ...outcome.receipt, replayed: true } }
    : outcome;
};
