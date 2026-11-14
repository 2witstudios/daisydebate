import {
  type ActionHistoryEntry,
  type CommandExpected,
  type CommandVersionName,
  type HistoryAuthority,
} from '@daisy/protocol/lobby/command';
import type {
  conflictBases,
  pendingCommandStatuses,
} from '@daisy/protocol/lobby';
import type {
  ConfirmationCommand,
  ConfirmationCommandRefusal,
} from '@daisy/protocol/lobby/confirmation-command';
import { refuse, type CommandDecision } from './run-command';

/**
 * Confirmation commands (TAB-5.12). A pending command is settled once.
 * Confirming re-runs it against current versions in the confirmer's
 * transaction and re-authorizes its proposer first: a proposer whose account
 * has since closed, or who no longer holds the stored command's gate, has
 * nothing confirmed. The re-run's own decision is the stored command's
 * decide function's, given here as a fact.
 */

/** A `pending_commands` row. */
export type PendingCommandRow = {
  readonly commandId: string;
  readonly lobbyId: string;
  readonly proposerUserId: string;
  readonly type: string;
  readonly payloadDigest: string;
  readonly expected: CommandExpected;
  readonly conflictId: string;
  readonly status: (typeof pendingCommandStatuses)[number];
  readonly expiresAt: string;
};

export type PendingWrite = {
  readonly table: 'pending_commands';
  readonly op: 'update';
  readonly commandId: string;
  readonly set: {
    readonly status: 'confirmed' | 'declined' | 'withdrawn';
    readonly settledAt: string;
    readonly settledByUserId: string;
  };
};
/** The proposer's own history entry, written when the confirmation applies it. */
export type ProposerHistoryWrite = {
  readonly table: 'action_history';
  readonly op: 'insert';
  readonly entry: ActionHistoryEntry;
};

export type SettleFacts = {
  readonly now: string;
  /** The account settling it: the confirmer, decliner or withdrawing proposer. */
  readonly settlerUserId: string;
  readonly pending: PendingCommandRow;
};

/**
 * What confirming needs beyond the row: the proposer re-authorized against
 * the stored command's gate now, the versions its definition checks as they
 * stand, and the stored command's decision against current facts.
 */
export type ConfirmFacts<
  RerunRefusal extends string,
  RerunWrite,
> = SettleFacts & {
  /** The proposer's `users` row. */
  readonly proposer: { readonly id: string; readonly deletedAt: string | null };
  readonly proposerAuthorization:
    | { readonly allow: false }
    | { readonly allow: true; readonly authority: HistoryAuthority };
  readonly scope: ActionHistoryEntry['scope'];
  readonly versions: readonly CommandVersionName[];
  readonly current: CommandExpected;
  readonly rerun: CommandDecision<RerunRefusal, RerunWrite>;
};

type Command<Type extends ConfirmationCommand['type']> = Extract<
  ConfirmationCommand,
  { readonly type: Type }
>;
type SettleRefusal = ConfirmationCommandRefusal | 'not-found';

const settledTo = (
  facts: SettleFacts,
  status: PendingWrite['set']['status'],
): PendingWrite => ({
  table: 'pending_commands',
  op: 'update',
  commandId: facts.pending.commandId,
  set: { status, settledAt: facts.now, settledByUserId: facts.settlerUserId },
});

/** Declining or withdrawing settles the pending command and applies nothing. */
export const decideSettle = (
  facts: SettleFacts,
  command: Command<'decline-command' | 'withdraw-command'>,
): CommandDecision<SettleRefusal, PendingWrite> => {
  if (command.pendingCommandId !== facts.pending.commandId)
    return refuse('not-found');
  if (facts.pending.status !== 'pending') return refuse('pending-settled');
  return {
    kind: 'accepted',
    aggregate: { kind: 'pending_command', id: facts.pending.commandId },
    resultingVersion: 1,
    writes: [
      settledTo(
        facts,
        command.type === 'decline-command' ? 'declined' : 'withdrawn',
      ),
    ],
    findings: [],
    fixtureChanges: [],
  };
};

const stale = (facts: ConfirmFacts<string, unknown>) =>
  facts.versions.some(
    (name) =>
      facts.pending.expected[name] === undefined ||
      facts.pending.expected[name] !== facts.current[name],
  );

/**
 * Confirms a pending command: re-authorizes the proposer, checks the
 * versions the proposer read, and applies the stored command's decision with
 * its own history entry naming proposer and confirmer.
 */
export const decideConfirm = <RerunRefusal extends string, RerunWrite>(
  facts: ConfirmFacts<RerunRefusal, RerunWrite>,
  command: Command<'confirm-command'>,
): CommandDecision<
  SettleRefusal | 'version-conflict' | RerunRefusal,
  PendingWrite | ProposerHistoryWrite | RerunWrite
> => {
  const { pending } = facts;
  if (command.pendingCommandId !== pending.commandId)
    return refuse('not-found');
  if (pending.status !== 'pending') return refuse('pending-settled');
  if (Date.parse(facts.now) >= Date.parse(pending.expiresAt))
    return refuse('pending-expired');
  if (facts.proposer.id !== pending.proposerUserId) return refuse('not-found');
  if (facts.proposer.deletedAt !== null) return refuse('proposer-closed');
  if (!facts.proposerAuthorization.allow)
    return refuse('proposer-unauthorized');
  if (stale(facts)) return refuse('version-conflict');
  const { rerun } = facts;
  if (rerun.kind === 'refused') return rerun;
  return {
    ...rerun,
    writes: [
      settledTo(facts, 'confirmed'),
      ...rerun.writes,
      {
        table: 'action_history',
        op: 'insert',
        entry: {
          commandId: pending.commandId,
          scope: facts.scope,
          aggregate: rerun.aggregate,
          type: pending.type,
          actorUserId: pending.proposerUserId,
          authority: facts.proposerAuthorization.authority,
          conflictId: pending.conflictId,
          confirmedByUserId: facts.settlerUserId,
          payloadDigest: pending.payloadDigest,
          resultingVersion: rerun.resultingVersion,
          appliedAt: facts.now,
        },
      },
    ],
  };
};

// ---- Conflict waivers ------------------------------------------------------

/** A `conflicts` row the evaluator recorded for the requester on the fixture. */
export type ConflictRow = {
  readonly id: string;
  readonly lobbyId: string;
  readonly userId: string;
  readonly fixtureId: string;
  readonly basis: (typeof conflictBases)[number];
  readonly handling: 'denied' | 'second_confirms' | 'flagged';
  readonly confirmedByUserId: string | null;
};

/**
 * A waiver request is held by the runner whenever the requester's conflict
 * needs a second person, so this decision runs only on its confirmation (or
 * when no confirmation applies). Confirmed, it writes the waiver: a new
 * conflict row carrying the confirmer.
 */
export type ConflictWaiverFacts = {
  readonly now: string;
  readonly mintedConflictId: string;
  /** The account that confirms the request; null on the requester's own send. */
  readonly confirmerUserId: string | null;
  readonly conflict: ConflictRow | null;
  /** Whether a waiver (a confirmed conflict row) already holds for the requester. */
  readonly waiverHolds: boolean;
};
export type ConflictWaiverWrite = {
  readonly table: 'conflicts';
  readonly op: 'insert';
  readonly row: Omit<ConflictRow, 'confirmedByUserId' | 'handling'> & {
    readonly handling: 'second_confirms';
    readonly confirmedByUserId: string;
    readonly detectedAt: string;
  };
};

export const decideConflictWaiver = (
  facts: ConflictWaiverFacts,
  command: Command<'request-conflict-waiver'>,
): CommandDecision<SettleRefusal, ConflictWaiverWrite> => {
  const { conflict } = facts;
  if (facts.waiverHolds) return refuse('waiver-exists');
  if (
    conflict === null ||
    conflict.fixtureId !== command.fixtureId ||
    conflict.handling !== 'second_confirms' ||
    facts.confirmerUserId === null
  )
    return refuse('handling-not-confirming');
  return {
    kind: 'accepted',
    aggregate: { kind: 'fixture', id: command.fixtureId },
    resultingVersion: 1,
    writes: [
      {
        table: 'conflicts',
        op: 'insert',
        row: {
          id: facts.mintedConflictId,
          lobbyId: conflict.lobbyId,
          userId: conflict.userId,
          fixtureId: conflict.fixtureId,
          basis: conflict.basis,
          handling: 'second_confirms',
          confirmedByUserId: facts.confirmerUserId,
          detectedAt: facts.now,
        },
      },
    ],
    findings: [],
    fixtureChanges: [],
  };
};
