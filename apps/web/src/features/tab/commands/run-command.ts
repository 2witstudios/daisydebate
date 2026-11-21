import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import {
  commandReplay,
  versionsHold,
  type StoredOutcome,
  type ActionHistoryEntry,
  type CommandExpected,
  type CommandFinding,
  type FixtureChange,
  type LobbyAggregateKind,
  type LobbyCommandAnswer,
  type LobbyCommandDefinition,
  type LobbyCommandEnvelope,
  type LobbyCommandReceipt,
} from '@daisy/protocol/lobby/command';

/**
 * What a command decides from the facts it was given: a named refusal, or
 * the rows to write described as data. Nothing is written by a decision.
 */
export type CommandDecision<Refusal extends string, Write> =
  | {
      readonly kind: 'refused';
      readonly refusal: Refusal;
      /** The people a refusal is about, where it names them (`slot-clash`). */
      readonly people?: readonly string[];
    }
  | {
      readonly kind: 'accepted';
      readonly aggregate: {
        readonly kind: LobbyAggregateKind;
        readonly id: string;
      };
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
type CommandScope = ActionHistoryEntry['scope'];

/**
 * What is stored for a command id: its history entry with the receipt it
 * answered, or its hold while a second person has yet to confirm it.
 */
export type StoredCommand = {
  readonly actorUserId: string | null;
  readonly payloadDigest: string;
  readonly outcome: StoredOutcome;
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
  readonly holdForConfirmation: (held: HeldCommand) => Promise<{
    readonly pendingCommandId: string;
    readonly expiresAt: string;
  }>;
  readonly apply: (
    writes: readonly Write[],
    history: ActionHistoryEntry,
    receipt: LobbyCommandReceipt,
  ) => Promise<void>;
};

/**
 * A held command, whole: what `pending_commands` stores so a confirmer can
 * apply it later as proposed (its payload, who proposed it, where it runs).
 */
type HeldCommand = {
  readonly commandId: string;
  readonly scope: CommandScope;
  readonly proposerUserId: string | null;
  readonly type: string;
  readonly payload: { readonly type: string };
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

type Allowed = Extract<AuthorizationDecision, { allow: true }>;
type HeldConflict = NonNullable<AuthorizationDecision['conflict']>;

/**
 * What the gate answers: allowed (perhaps with a flagged conflict), or held
 * for a second person, which the evaluator answers as a denial whose reason
 * is `confirmation-required`. Every other denial is a public error.
 */
type Gate =
  | { readonly kind: 'allowed'; readonly decision: Allowed }
  | { readonly kind: 'confirm'; readonly conflict: HeldConflict };

const gateOf = (
  definition: LobbyCommandDefinition,
  authorize: (input: AuthorizationInput) => AuthorizationDecision,
  input: Omit<AuthorizationInput, 'capability'>,
): Gate => {
  let denied: Extract<AuthorizationDecision, { allow: false }> | null = null;
  for (const capability of definition.gate) {
    const decision = authorize({ ...input, capability });
    if (decision.allow) return { kind: 'allowed', decision };
    denied ??= decision;
  }
  if (denied?.reason === 'confirmation-required' && denied.conflict !== null)
    return { kind: 'confirm', conflict: denied.conflict };
  throw new CommandDenied(denied?.reason ?? 'denied');
};

/** Action history names the account, which outlives any actor. */
const accountOf = (input: Omit<AuthorizationInput, 'capability'>) =>
  input.principal.kind === 'user' ? input.principal.userId : null;

export const commandHistoryAuthority = (
  principal: AuthorizationInput['principal'],
  authority: Extract<AuthorizationDecision, { allow: true }>['authority'],
): ActionHistoryEntry['authority'] => {
  if (principal.kind === 'service')
    return { kind: 'service', serviceId: principal.serviceId };
  switch (authority.kind) {
    case 'fixed':
      return { kind: 'fixed' };
    case 'owner':
      return { kind: 'owner' };
    case 'grant':
      return { kind: 'grant', grantId: authority.grantId };
    case 'relationship':
      return { kind: 'relationship', relation: authority.relation };
  }
};

/**
 * Runs one lobby command: replay by command id and digest first, then the
 * gate, the conflict rule, the version checks and the decision, and on
 * acceptance the writes and one action-history entry in the same
 * transaction. The decision adapter can load protected facts after the gate.
 * A refused command changes nothing.
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
  decide: (
    facts: Facts,
    command: Command,
  ) =>
    CommandDecision<Refusal, Write> | Promise<CommandDecision<Refusal, Write>>,
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
    switch (replay.kind) {
      case 'replay':
        return { kind: 'accepted', receipt: replay.receipt };
      case 'settled':
        return replay;
      case 'pending':
        return {
          kind: 'pending',
          pendingCommandId: replay.pendingCommandId,
          expiresAt: replay.expiresAt,
        };
      case 'conflict':
        return { kind: 'refused', refusal: 'command-conflict' };
      case 'new':
        break;
    }
    const gate = gateOf(definition, dependencies.authorize, input);
    // A refused command changes nothing: versions and the decision are
    // settled before any conflict is recorded or any hold is stored.
    if (
      !versionsHold(definition.versions, envelope.expected, tx.versions(facts))
    )
      return { kind: 'refused', refusal: 'version-conflict' };
    const outcome = await decide(facts, envelope.command);
    if (outcome.kind === 'refused') return outcome;
    const conflict =
      gate.kind === 'confirm' ? gate.conflict : gate.decision.conflict;
    const conflictId =
      conflict === null ? null : await tx.recordConflict(conflict);
    if (gate.kind === 'confirm') {
      const held = await tx.holdForConfirmation({
        commandId: envelope.commandId,
        scope: tx.scope(facts),
        proposerUserId: actorUserId,
        type: envelope.command.type,
        payload: envelope.command,
        payloadDigest,
        expected: envelope.expected,
        conflictId: conflictId ?? (await tx.recordConflict(gate.conflict)),
      });
      return { kind: 'pending', ...held };
    }
    const { decision } = gate;
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
        authority: commandHistoryAuthority(input.principal, decision.authority),
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
