import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import {
  commandReplay,
  type ActionHistoryEntry,
  type CommandExpected,
  type CommandFinding,
  type FixtureChange,
  type LobbyAggregateKind,
  type LobbyCommandAnswer,
  type LobbyCommandDefinition,
  type LobbyCommandEnvelope,
  type LobbyCommandReceipt,
} from '@daisy/protocol/lobby-command';

/**
 * What a command decides from the facts it was given: a named refusal, or
 * the rows to write described as data. Nothing is written by a decision.
 */
export type CommandDecision<Refusal extends string, Write> =
  | { readonly kind: 'refused'; readonly refusal: Refusal }
  | {
      readonly kind: 'accepted';
      readonly aggregate: { readonly kind: LobbyAggregateKind; readonly id: string };
      readonly resultingVersion: number;
      readonly writes: readonly Write[];
      readonly findings: readonly CommandFinding[];
      readonly fixtureChanges: readonly FixtureChange[];
    };

export const refuse = <Refusal extends string>(
  refusal: Refusal,
): { readonly kind: 'refused'; readonly refusal: Refusal } => ({
  kind: 'refused',
  refusal,
});

/** Where a command's history entry belongs. */
export type CommandScope = ActionHistoryEntry['scope'];

/** The stored history entry for a command id, with the receipt it answered. */
export type StoredCommand = {
  readonly actorUserId: string | null;
  readonly payloadDigest: string;
  readonly receipt: LobbyCommandReceipt;
};

/**
 * One transaction's view of the store, as the runner needs it. Its Postgres
 * implementation (loading facts under the aggregate's lock, applying the
 * writes and the history entry in one transaction) is wiring's.
 */
export type CommandTransaction<Facts, Write> = {
  readonly stored: (commandId: string) => Promise<StoredCommand | null>;
  readonly facts: () => Promise<Facts>;
  /** Everything `authorize` needs but the capability. */
  readonly authority: (facts: Facts) => Omit<AuthorizationInput, 'capability'>;
  /** The current version of each name the command may check. */
  readonly versions: (facts: Facts) => CommandExpected;
  readonly scope: (facts: Facts) => CommandScope;
  /** Records a detected conflict, an observation outside the aggregate. */
  readonly recordConflict: (
    conflict: NonNullable<AuthorizationDecision['conflict']>,
  ) => Promise<string>;
  /** Holds the command whole for a second person's confirmation. */
  readonly holdForConfirmation: (
    held: HeldCommand,
  ) => Promise<{ readonly pendingCommandId: string; readonly expiresAt: string }>;
  readonly apply: (
    writes: readonly Write[],
    history: ActionHistoryEntry,
    receipt: LobbyCommandReceipt,
  ) => Promise<void>;
};

export type HeldCommand = {
  readonly commandId: string;
  readonly type: string;
  readonly payloadDigest: string;
  readonly expected: CommandExpected;
  readonly conflictId: string;
};

export type CommandDependencies<Facts, Write> = {
  readonly transaction: <Answer>(
    work: (tx: CommandTransaction<Facts, Write>) => Promise<Answer>,
  ) => Promise<Answer>;
  readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
  readonly digest: (value: unknown) => string;
  readonly now: () => string;
};

/** A denial is a public error, never a refusal: it answers as not found. */
export class CommandDenied extends Error {
  constructor(readonly reason: string) {
    super('not-found');
  }
}

const allowedUnder = (
  definition: LobbyCommandDefinition,
  authorize: (input: AuthorizationInput) => AuthorizationDecision,
  input: Omit<AuthorizationInput, 'capability'>,
): Extract<AuthorizationDecision, { allow: true }> => {
  let denied: Extract<AuthorizationDecision, { allow: false }> | null = null;
  for (const capability of definition.gate) {
    const decision = authorize({ ...input, capability });
    if (decision.allow) return decision;
    denied ??= decision;
  }
  throw new CommandDenied(denied?.reason ?? 'denied');
};

const versionConflict = (
  definition: LobbyCommandDefinition,
  expected: CommandExpected,
  current: CommandExpected,
): boolean =>
  definition.versions.some(
    (name) => expected[name] === undefined || expected[name] !== current[name],
  );

/** Action history names the account, which outlives any actor. */
const accountOf = (input: Omit<AuthorizationInput, 'capability'>) =>
  input.principal.kind === 'user' ? input.principal.userId : null;

const historyAuthority = (
  input: Omit<AuthorizationInput, 'capability'>,
  decision: Extract<AuthorizationDecision, { allow: true }>,
): ActionHistoryEntry['authority'] => {
  if (input.principal.kind === 'service')
    return { kind: 'service', serviceId: input.principal.serviceId };
  switch (decision.authority.kind) {
    case 'fixed':
      return { kind: 'fixed' };
    case 'owner':
      return { kind: 'owner' };
    case 'grant':
      return { kind: 'grant', grantId: decision.authority.grantId };
    case 'relationship':
      return { kind: 'relationship', relation: decision.authority.relation };
  }
};

/**
 * Runs one lobby command: replay by command id and digest first, then the
 * gate, the conflict rule, the version checks and the decision, and on
 * acceptance the writes and one action-history entry in the same
 * transaction. A refused command changes nothing.
 */
export const runLobbyCommand = <
  Command extends { readonly type: string },
  Facts,
  Refusal extends string,
  Write,
>(
  dependencies: CommandDependencies<Facts, Write>,
  envelope: LobbyCommandEnvelope<Command>,
  definition: LobbyCommandDefinition<Refusal>,
  decide: (facts: Facts, command: Command) => CommandDecision<Refusal, Write>,
): Promise<LobbyCommandAnswer<Refusal>> =>
  dependencies.transaction(async (tx) => {
    const payloadDigest = dependencies.digest({
      expected: envelope.expected,
      command: envelope.command,
    });
    const facts = await tx.facts();
    const input = tx.authority(facts);
    const actorUserId = accountOf(input);
    const replay = commandReplay(await tx.stored(envelope.commandId), {
      actorUserId,
      payloadDigest,
    });
    if (replay.kind === 'replay')
      return { kind: 'accepted', receipt: replay.receipt };
    if (replay.kind === 'conflict')
      return { kind: 'refused', refusal: 'command-conflict' };
    const decision = allowedUnder(definition, dependencies.authorize, input);
    const conflict = decision.conflict;
    const conflictId =
      conflict === null ? null : await tx.recordConflict(conflict);
    if (
      conflictId !== null &&
      conflict?.handling === 'second_confirms' &&
      conflict.waiverId === null
    ) {
      const held = await tx.holdForConfirmation({
        commandId: envelope.commandId,
        type: envelope.command.type,
        payloadDigest,
        expected: envelope.expected,
        conflictId,
      });
      return { kind: 'pending', ...held };
    }
    if (versionConflict(definition, envelope.expected, tx.versions(facts)))
      return { kind: 'refused', refusal: 'version-conflict' };
    const outcome = decide(facts, envelope.command);
    if (outcome.kind === 'refused') return outcome;
    const receipt: LobbyCommandReceipt = {
      commandId: envelope.commandId,
      aggregate: outcome.aggregate,
      resultingVersion: outcome.resultingVersion,
      replayed: false,
      findings: [...outcome.findings],
      fixtureChanges: [...outcome.fixtureChanges],
    };
    await tx.apply(
      outcome.writes,
      {
        commandId: envelope.commandId,
        scope: tx.scope(facts),
        aggregate: outcome.aggregate,
        type: envelope.command.type,
        actorUserId,
        authority: historyAuthority(input, decision),
        conflictId,
        confirmedByUserId: null,
        payloadDigest,
        resultingVersion: outcome.resultingVersion,
        appliedAt: dependencies.now(),
      },
      receipt,
    );
    return { kind: 'accepted', receipt };
  });
